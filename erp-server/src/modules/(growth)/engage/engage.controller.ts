import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { OrgId } from '../../../common/tenant';
import {
  saveReplyDraftSchema,
  type SaveReplyDraftDto,
} from './dto/save-reply-draft.dto';
import { sendReplySchema, type SendReplyDto } from './dto/send-reply.dto';
import { EngageService } from './engage.service';

const demoSeedSchema = z.object({ campaignId: z.string().uuid().optional() });

// The Engage plane for the web UI. JWT-protected by the global guard; every handler is
// org-scoped via @OrgId. `replyId` is a prospectId (one conversation per prospect).
@Controller('growth/engage')
export class EngageController {
  constructor(private readonly engageService: EngageService) {}

  @Get('campaigns')
  getCampaigns(@OrgId() orgId: string) {
    return this.engageService.getCampaigns(orgId);
  }

  // Sync real inbound Gmail into the queue (match-known-prospects-only). Idempotent.
  @Post('inbox/sync')
  syncInbox(@OrgId() orgId: string) {
    return this.engageService.syncInbox(orgId);
  }

  @Get('campaigns/:campaignId/replies')
  getReplies(@OrgId() orgId: string, @Param('campaignId') campaignId: string) {
    return this.engageService.getReplies(orgId, campaignId);
  }

  // Batch-classify every un-classified inbound reply in the campaign (Reply Glock).
  @Post('campaigns/:campaignId/classify')
  classify(@OrgId() orgId: string, @Param('campaignId') campaignId: string) {
    return this.engageService.classifyCampaign(orgId, campaignId);
  }

  @Get('replies/:replyId/thread')
  getThread(@OrgId() orgId: string, @Param('replyId') replyId: string) {
    return this.engageService.getThread(orgId, replyId);
  }

  // Classify + draft one reply via Reply Glock.
  @Post('replies/:replyId/run-reply-glock')
  runReplyGlock(@OrgId() orgId: string, @Param('replyId') replyId: string) {
    return this.engageService.runReplyGlock(orgId, replyId);
  }

  // Draft a grounded answer for an UNSURE reply via the RAG agent.
  @Post('replies/:replyId/run-rag')
  runRag(@OrgId() orgId: string, @Param('replyId') replyId: string) {
    return this.engageService.runRag(orgId, replyId);
  }

  @Patch('replies/:replyId/draft')
  saveDraft(
    @OrgId() orgId: string,
    @Param('replyId') replyId: string,
    @Body() body: SaveReplyDraftDto,
  ) {
    const dto = saveReplyDraftSchema.parse(body);
    return this.engageService.saveDraft(orgId, replyId, dto);
  }

  // Deferred to the Google-OAuth phase — returns 503 until sending is enabled.
  @Post('replies/:replyId/send')
  sendReply(
    @OrgId() orgId: string,
    @Param('replyId') replyId: string,
    @Body() body: SendReplyDto,
  ) {
    const dto = sendReplySchema.parse(body);
    return this.engageService.sendReply(orgId, replyId, dto);
  }

  // Deferred — Reply Glock feedback/rewrite mode (v2). Returns 503 for now.
  @Post('replies/:replyId/ai-feedback')
  aiFeedback(@OrgId() orgId: string, @Param('replyId') replyId: string) {
    return this.engageService.aiFeedback(orgId, replyId);
  }

  // Dev helper: seed 3 classified demo replies into a campaign so the UI shows real
  // DB data end-to-end without the agent gateway.
  @Post('demo-seed')
  demoSeed(@OrgId() orgId: string, @Body() body: unknown) {
    const dto = demoSeedSchema.parse(body ?? {});
    return this.engageService.seedDemo(orgId, dto.campaignId);
  }
}
