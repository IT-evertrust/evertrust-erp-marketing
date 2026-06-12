import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { schema } from '@evertrust/db';
import {
  ReplyVerdict,
  type ClearResultDto,
  type OutreachMessageDto,
  type ReplyClassificationDtoRead,
  type ReplyClassificationResultDto,
  type ReplyDraftDto,
  type SuppressionListItemDto,
  type SuppressionResultDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { OutreachMessagesService } from './outreach-messages.service';
import { ReplyClassificationsService } from './reply-classifications.service';
import { SuppressionsService } from './suppressions.service';
import {
  CreateOutreachMessageBodyDto,
  ReplyClassificationBodyDto,
  SuppressionBodyDto,
} from './outreach.dto';

type OutreachMessageRow = typeof schema.outreachMessages.$inferSelect;
type SuppressionRow = typeof schema.suppressions.$inferSelect;

// Map an outreach_messages row to its HTTP DTO (timestamps → ISO strings).
function toMessageDto(r: OutreachMessageRow): OutreachMessageDto {
  return {
    id: r.id,
    prospectId: r.prospectId,
    direction: r.direction,
    status: r.status,
    gmailMessageId: r.gmailMessageId,
    gmailThreadId: r.gmailThreadId,
    subject: r.subject,
    bodySnippet: r.bodySnippet,
    templateAssetId: r.templateAssetId,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}

// Map a suppressions row to its HTTP DTO (timestamps → ISO strings).
function toSuppressionDto(r: SuppressionRow): SuppressionListItemDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    email: r.email,
    reason: r.reason,
    sourceProspectId: r.sourceProspectId,
    createdAt: r.createdAt.toISOString(),
  };
}

// Outreach reply plane. MIXED auth (like campaigns.controller):
//  - MACHINE routes (@Public() + ArsenalTokenGuard at the METHOD level): the
//    conversation ledger writes/reads, the Reply Glock / RAG verdict log and the
//    do-not-contact upsert; org derived from the parent prospect/campaign; audited
//    (actorType N8N) inside the services. n8n's paths are unchanged.
//  - JWT routes (the UI): org-scoped via req.user.organizationId + RBAC. The draft
//    review queue, the conversation timeline, and the suppression list/delete live
//    at distinct sub-paths so they never collide with the machine routes.
@Controller()
export class OutreachController {
  constructor(
    private readonly messages: OutreachMessagesService,
    private readonly replies: ReplyClassificationsService,
    private readonly suppressions: SuppressionsService,
  ) {}

  // ---- JWT (UI) routes — org-scoped -----------------------------------------

  // The DRAFT REVIEW QUEUE (org-scoped): reply_classifications rows that have a
  // non-null suggestedReply, joined with prospect (email + companyName) + campaignId
  // + the prospect's latest verdict. Filter: prospectId, limit. Distinct sub-path
  // (/reply-classifications/queue) so it does not collide with the machine GET.
  @RequirePermissions('campaigns:read')
  @Get('reply-classifications/queue')
  draftQueue(
    @OrgId() orgId: string,
    @Query('prospectId') prospectId?: string,
    @Query('limit') limitParam?: string,
  ): Promise<ReplyDraftDto[]> {
    const limit = Number.parseInt(limitParam ?? '', 10);
    return this.replies.draftQueue(orgId, {
      prospectId: prospectId || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }

  // The conversation timeline for a prospect (org-scoped): the message ledger,
  // newest-first. Required query: prospectId (the prospect must be in the caller's
  // org — 404 otherwise). Distinct sub-path so it does not collide with machine GET.
  @RequirePermissions('campaigns:read')
  @Get('outreach-messages/thread')
  async thread(
    @OrgId() orgId: string,
    @Query('prospectId', ParseUUIDPipe) prospectId: string,
    @Query('limit') limitParam?: string,
  ): Promise<OutreachMessageDto[]> {
    const limit = Number.parseInt(limitParam ?? '', 10);
    const rows = await this.messages.listForOrg(
      orgId,
      prospectId,
      Number.isFinite(limit) ? limit : undefined,
    );
    return rows.map(toMessageDto);
  }

  // The org's do-not-contact list (org-scoped, newest-first).
  @RequirePermissions('campaigns:read')
  @Get('suppressions')
  async listSuppressions(
    @OrgId() orgId: string,
  ): Promise<SuppressionListItemDto[]> {
    const rows = await this.suppressions.listForOrg(orgId);
    return rows.map(toSuppressionDto);
  }

  // Un-suppress (the human override): remove one suppression in the caller's org.
  // org-scoped + audited (campaigns:write). 404 if missing or cross-org.
  @RequirePermissions('campaigns:write')
  @Delete('suppressions/:id')
  async unsuppress(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ClearResultDto> {
    const result = await this.suppressions.deleteForOrg(orgId, id);
    setAuditContext(req, {
      entity: 'suppressions',
      entityId: id,
      action: 'DELETE',
      after: result,
    });
    return { deleted: result.deleted ? 1 : 0 };
  }

  // ---- MACHINE routes — @Public() + ArsenalTokenGuard -----------------------

  // Record a send/reply in the conversation ledger. UPSERTS on gmailMessageId when
  // present (re-polled threads must not double-insert), else inserts. 404 if the
  // prospect is unknown. Returns the row.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post('outreach-messages')
  @HttpCode(HttpStatus.CREATED)
  async createMessage(
    @Body() body: CreateOutreachMessageBodyDto,
  ): Promise<OutreachMessageDto> {
    const row = await this.messages.create(body);
    return toMessageDto(row);
  }

  // The conversation ledger (newest-first) — the RAG Agent + Reply Glock thread
  // pull. Filters: prospectId, gmailThreadId, limit (default 50).
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Get('outreach-messages')
  async listMessages(
    @Query('prospectId') prospectId?: string,
    @Query('gmailThreadId') gmailThreadId?: string,
    @Query('limit') limitParam?: string,
  ): Promise<OutreachMessageDto[]> {
    const limit = Number.parseInt(limitParam ?? '', 10);
    const rows = await this.messages.list({
      prospectId: prospectId || undefined,
      gmailThreadId: gmailThreadId || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return rows.map(toMessageDto);
  }

  // The verdict log joined with prospect context (newest-first). `needsRag=true` is
  // the RAG drafting backlog (UNSURE rows with no drafted sibling reply yet).
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Get('reply-classifications')
  listClassifications(
    @Query('verdict') verdictParam?: string,
    @Query('prospectId') prospectId?: string,
    @Query('needsRag') needsRag?: string,
    @Query('limit') limitParam?: string,
  ): Promise<ReplyClassificationDtoRead[]> {
    const verdict = ReplyVerdict.safeParse(verdictParam);
    const limit = Number.parseInt(limitParam ?? '', 10);
    return this.replies.list({
      verdict: verdict.success ? verdict.data : undefined,
      prospectId: prospectId || undefined,
      needsRag: needsRag === 'true',
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }

  // Record an inbound-reply verdict + project it onto the prospect's status. Returns
  // the row id + the resulting prospect status. 404 if the prospect is unknown.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post('reply-classifications')
  @HttpCode(HttpStatus.CREATED)
  classify(
    @Body() body: ReplyClassificationBodyDto,
  ): Promise<ReplyClassificationResultDto> {
    return this.replies.create(body);
  }

  // Add an address to the org do-not-contact list (upsert on org,email).
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post('suppressions')
  @HttpCode(HttpStatus.CREATED)
  suppress(@Body() body: SuppressionBodyDto): Promise<SuppressionResultDto> {
    return this.suppressions.create(body);
  }
}
