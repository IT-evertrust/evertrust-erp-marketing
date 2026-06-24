import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { schema } from '@evertrust/db';
import {
  ProspectStatus,
  type GraduateProspectResultDto,
  type ProspectBulkResultDto,
  type ProspectDto,
  type ProspectListDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { ProspectsService } from './prospects.service';
import {
  GraduateProspectBodyDto,
  ProspectBulkBodyDto,
  UpdateProspectBodyDto,
  UpdateProspectStageBodyDto,
  UpdateProspectStatusBodyDto,
} from './prospects.dto';

type ProspectRow = typeof schema.prospects.$inferSelect;

// An optional ISO date query param → Date, or undefined if absent/invalid.
function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Map a prospect row to its HTTP DTO (timestamps → ISO strings).
function toDto(r: ProspectRow): ProspectDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    campaignId: r.campaignId,
    nicheTargetId: r.nicheTargetId,
    email: r.email,
    companyName: r.companyName,
    website: r.website,
    city: r.city,
    country: r.country,
    sourceUrl: r.sourceUrl,
    emailVerified: r.emailVerified,
    status: r.status,
    pipelineStage: r.pipelineStage,
    snoozeUntil: r.snoozeUntil ? r.snoozeUntil.toISOString() : null,
    followupCount: r.followupCount,
    lastContactedAt: r.lastContactedAt ? r.lastContactedAt.toISOString() : null,
    leadId: r.leadId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Cold-outreach prospect data plane. MIXED auth (like campaigns.controller):
//  - MACHINE routes (the arsenal stages) are @Public() + ArsenalTokenGuard at the
//    METHOD level; org is derived from the campaign. n8n calls GET /prospects
//    (sendList/snoozeDue/email), POST /prospects/bulk, PATCH /prospects/:id,
//    POST /prospects/:id/graduate — these paths are unchanged.
//  - JWT routes (the UI) are org-scoped via req.user.organizationId + RBAC. The
//    board list lives at GET /prospects/board so it does NOT collide with the
//    machine GET /prospects the n8n send-list pull already uses.
@Controller('prospects')
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  // ---- JWT (UI) routes — org-scoped -----------------------------------------

  // The campaign/board view (org-scoped). Filters: campaignId, status, q (email/
  // companyName substring), limit (default 50), offset. Returns the page + total +
  // the per-status tally for the board columns. Declared BEFORE the machine GET so
  // its path is distinct, and BEFORE GET /:id so "board" is never a route param.
  @RequirePermissions('campaigns:read')
  @Get('board')
  async board(
    @OrgId() orgId: string,
    @Query('campaignId') campaignIdParam?: string,
    @Query('status') statusParam?: string,
    @Query('q') q?: string,
    @Query('nicheTargetId') nicheTargetIdParam?: string,
    @Query('createdFrom') createdFromParam?: string,
    @Query('createdTo') createdToParam?: string,
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
  ): Promise<ProspectListDto> {
    const status = ProspectStatus.safeParse(statusParam);
    const campaignId = z.string().uuid().safeParse(campaignIdParam);
    const nicheTargetId = z.string().uuid().safeParse(nicheTargetIdParam);
    const limit = Number.parseInt(limitParam ?? '', 10);
    const offset = Number.parseInt(offsetParam ?? '', 10);
    const result = await this.prospects.boardList(orgId, {
      campaignId: campaignId.success ? campaignId.data : undefined,
      nicheTargetId: nicheTargetId.success ? nicheTargetId.data : undefined,
      createdFrom: parseDate(createdFromParam),
      createdTo: parseDate(createdToParam),
      status: status.success ? status.data : undefined,
      q: q || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
    return {
      items: result.items.map(toDto),
      total: result.total,
      statusCounts: result.statusCounts as ProspectListDto['statusCounts'],
      stageCounts: result.stageCounts as ProspectListDto['stageCounts'],
    };
  }

  // One prospect detail for the UI drawer (org-scoped). 404 if cross-org. Includes
  // the resolved campaign + niche-target display names.
  @RequirePermissions('campaigns:read')
  @Get(':id/detail')
  async detail(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProspectDto & { campaignName: string | null; nicheTargetName: string | null }> {
    const row = await this.prospects.getForOrg(orgId, id);
    const names = await this.prospects.resolveNames(row);
    return { ...toDto(row), ...names };
  }

  // Manual status override from the UI (archive / re-open). org-scoped + audited
  // (campaigns:write). Distinct from the machine PATCH /:id which the stages use.
  @RequirePermissions('campaigns:write')
  @Patch(':id/status')
  async updateStatus(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProspectStatusBodyDto,
    @Req() req: Request,
  ): Promise<ProspectDto> {
    const row = await this.prospects.updateStatusForOrg(orgId, id, {
      status: body.status,
      snoozeUntil: body.snoozeUntil,
    });
    setAuditContext(req, {
      entity: 'prospects',
      entityId: row.id,
      action: 'STATUS_OVERRIDE',
      after: { status: row.status },
    });
    return toDto(row);
  }

  // Manual pipeline-stage move from the Nurture kanban (drag-and-drop). org-scoped +
  // audited (campaigns:write). Sets ONLY the human sales stage — never the agent-
  // driven outreach status. Distinct sub-path so it never hits the machine PATCH /:id.
  @RequirePermissions('campaigns:write')
  @Patch(':id/stage')
  async updateStage(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProspectStageBodyDto,
    @Req() req: Request,
  ): Promise<ProspectDto> {
    const row = await this.prospects.updateStageForOrg(
      orgId,
      id,
      body.pipelineStage,
    );
    setAuditContext(req, {
      entity: 'prospects',
      entityId: row.id,
      action: 'STAGE_MOVE',
      after: { pipelineStage: row.pipelineStage },
    });
    return toDto(row);
  }

  // ---- MACHINE routes (the arsenal) — @Public() + ArsenalTokenGuard ----------

  // Upsert a Lead Satellite scrape batch on (campaignId, email). Conflict updates
  // scraped fields only; conversation state never regresses. { created, updated }.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post('bulk')
  bulk(@Body() body: ProspectBulkBodyDto): Promise<ProspectBulkResultDto> {
    return this.prospects.bulkUpsert(body.campaignId, body.prospects);
  }

  // The prospect list with the arsenal filters (campaignId, status, email,
  // snoozeDue, limit). (The n8n sendList send-queue gate was retired.)
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Get()
  async list(
    @Query('campaignId') campaignId?: string,
    @Query('status') statusParam?: string,
    @Query('email') email?: string,
    @Query('snoozeDue') snoozeDue?: string,
    @Query('limit') limitParam?: string,
  ): Promise<ProspectDto[]> {
    const status = ProspectStatus.safeParse(statusParam);
    const limit = Number.parseInt(limitParam ?? '', 10);
    const rows = await this.prospects.list({
      campaignId: campaignId || undefined,
      status: status.success ? status.data : undefined,
      email: email || undefined,
      snoozeDue: snoozeDue === 'true',
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return rows.map(toDto);
  }

  // Partial update (status / snooze / followup / lastContacted / emailVerified /
  // leadId). 404 if the prospect id is unknown.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProspectBodyDto,
  ): Promise<ProspectDto> {
    const row = await this.prospects.update(id, body);
    return toDto(row);
  }

  // Graduate an INTERESTED prospect into a hot lead (Reply Glock). IDEMPOTENT:
  // re-graduating returns the existing lead; an existing (org,email) lead is linked
  // not duplicated. Returns { lead, graduated }. 404 if the prospect is unknown.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post(':id/graduate')
  graduate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GraduateProspectBodyDto,
  ): Promise<GraduateProspectResultDto> {
    return this.prospects.graduate(id, body);
  }
}
