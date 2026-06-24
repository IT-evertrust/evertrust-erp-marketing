import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  ConnectedGoogleAccountDto,
  EngageReplyListDto,
  EngageScanResultDto,
} from '@evertrust/shared';
import { Delete, Patch } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { EngageService } from './engage.service';
import { EngageRepliesService } from './engage-replies.service';
import { EngageScanService } from './engage-scan.service';
import { GmailWatchService } from './gmail-watch.service';
import {
  CampaignPersonaBodyDto,
  CampaignReplyBodyDto,
  CampaignReplyBookedBodyDto,
  CreatePersonaBodyDto,
  EngageSendBodyDto,
  RedraftBodyDto,
  TrainingNoteBodyDto,
  UpdatePersonaBodyDto,
} from './engage.dto';

// Engage · ERP-DIRECT Gmail reply pipeline. JWT-auth + tenant-scoped (@OrgId),
// gated by the campaigns RBAC (read for the queue, write for scan/send/redraft).
// JwtAuthGuard + PermissionsGuard are global (APP_GUARD) — no @UseGuards here.
// GET /replies and POST /scan degrade to a `configured: false` shell rather than
// erroring; POST /:id/send and /:id/redraft surface a 400 when the row is not in
// the calling org.
@Controller('engage')
export class EngageController {
  constructor(
    private readonly engage: EngageService,
    private readonly campaignReplies: EngageRepliesService,
    private readonly scanService: EngageScanService,
    private readonly watch: GmailWatchService,
  ) {}

  // --- CAMPAIGN-CENTRIC reply pipeline (reply_glock classify + draft + send) ---

  // Run the classifier over every lead's thread in a campaign and persist the
  // results. SLOW (~35s/lead on local Hermes) — runs once, the queue reads instantly.
  @RequirePermissions('campaigns:write')
  @Post('campaigns/:aimId/scan')
  scanCampaign(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.campaignReplies.scanCampaign(orgId, aimId);
  }

  // Manual "scan all now" — classify every campaign in the org. Same work the hourly
  // auto-scan does, on demand (the "manual scanning" button).
  @RequirePermissions('campaigns:write')
  @Post('scan-all')
  scanAll(@OrgId() orgId: string) {
    return this.scanService.scanAllForOrg(orgId);
  }

  // Scan one inbox (all campaigns that send from it) for new replies — the inbox
  // toggle's "Scan now". Campaigns sharing the mailbox share the rescan.
  @RequirePermissions('campaigns:write')
  @Post('scan-inbox')
  scanInbox(@OrgId() orgId: string, @Query('email') email: string) {
    return this.scanService.scanForMailbox(orgId, email);
  }

  // --- gmail.watch real-time controls ---

  // Register a gmail.watch on every connected mailbox (needs GMAIL_PUBSUB_TOPIC).
  @RequirePermissions('campaigns:write')
  @Post('gmail/watch/register')
  registerWatch(@OrgId() orgId: string) {
    return this.watch.registerAllForOrg(orgId);
  }

  // Stop every gmail.watch in the org.
  @RequirePermissions('campaigns:write')
  @Post('gmail/watch/stop')
  stopWatch(@OrgId() orgId: string) {
    return this.watch.stopAllForOrg(orgId);
  }

  // Whether gmail.watch (Pub/Sub) is configured on this server.
  @RequirePermissions('campaigns:read')
  @Get('gmail/watch/status')
  watchStatus() {
    return { configured: this.watch.isConfigured() };
  }

  // DEV/TEST (F2): seed synthetic outreach→reply Gmail threads into the campaign
  // mailbox so a scan has real threads to classify. No real send (messages.insert).
  @RequirePermissions('campaigns:write')
  @Post('campaigns/:aimId/seed-threads')
  seedThreads(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.campaignReplies.seedSyntheticThreads(orgId, aimId);
  }

  // The persisted, classified replies for a campaign (the reply-sorter queue).
  @RequirePermissions('campaigns:read')
  @Get('campaigns/:aimId/replies')
  campaignReplyList(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.campaignReplies.listReplies(orgId, aimId);
  }

  // Save an edited draft for a campaign reply.
  @RequirePermissions('campaigns:write')
  @Patch('campaign-replies/:id/draft')
  saveCampaignDraft(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CampaignReplyBodyDto,
  ) {
    return this.campaignReplies.saveDraft(orgId, id, body.subject, body.body);
  }

  // Send the (edited) draft to the lead, threaded onto the existing conversation.
  // An optional `proposedSlot` books a tentative intro-call on the campaign mailbox's
  // calendar AFTER the reply sends (best-effort — a calendar failure never fails the send).
  @RequirePermissions('campaigns:write')
  @Post('campaign-replies/:id/send')
  sendCampaignReply(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CampaignReplyBodyDto,
  ) {
    return this.campaignReplies.sendReply(
      orgId,
      id,
      body.subject,
      body.body,
      body.proposedSlot,
      body.proposedSlots,
    );
  }

  // Mark a campaign reply BOOKED — the operator confirmed the meeting in Activate and
  // hands its id back, so the reply threads into the CRM (and, when the campaign is
  // attributed, the meeting links to the campaign). Idempotent; 400 if not in the org.
  @RequirePermissions('campaigns:write')
  @Patch('campaign-replies/:id/booked')
  markCampaignReplyBooked(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CampaignReplyBookedBodyDto,
  ) {
    return this.campaignReplies.markBooked(orgId, id, body.meetingId);
  }

  // Proposed free meeting slots for a campaign (org's default calendar, next 7 days,
  // business hours). Feeds the "propose a slot" picker on a campaign reply. Never 500s —
  // returns a `configured: false` shell when the org has no calendar connected.
  @RequirePermissions('campaigns:read')
  @Get('campaigns/:aimId/free-slots')
  campaignFreeSlots(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.campaignReplies.campaignFreeSlots(orgId, aimId);
  }

  // --- PERSONA (F4): draft in a salesperson's voice ---
  // The org's personas (shared with Activate coaching) — feeds the persona picker.
  @RequirePermissions('campaigns:read')
  @Get('personas')
  personas(@OrgId() orgId: string) {
    return this.campaignReplies.listPersonas(orgId);
  }

  // Create a new drafting persona (name + voice rules) — the "+" beside the picker.
  @RequirePermissions('campaigns:write')
  @Post('personas')
  createPersona(@OrgId() orgId: string, @Body() body: CreatePersonaBodyDto) {
    return this.campaignReplies.createPersona(orgId, body.name, body.rules);
  }

  // One persona's detail incl. its voice rules — feeds the edit dialog.
  @RequirePermissions('campaigns:read')
  @Get('personas/:id')
  getPersona(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaignReplies.getPersona(orgId, id);
  }

  // Edit an existing persona's name and/or voice rules.
  @RequirePermissions('campaigns:write')
  @Patch('personas/:id')
  updatePersona(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePersonaBodyDto,
  ) {
    return this.campaignReplies.updatePersona(orgId, id, {
      name: body.name,
      rules: body.rules,
    });
  }

  // Set (or clear, personaId=null) the drafting persona for a campaign.
  @RequirePermissions('campaigns:write')
  @Patch('campaigns/:aimId/persona')
  setCampaignPersona(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
    @Body() body: CampaignPersonaBodyDto,
  ) {
    return this.campaignReplies.setCampaignPersona(orgId, aimId, body.personaId);
  }

  // Re-draft every unhandled reply in a campaign in its CURRENT persona voice — run
  // after switching the Draft persona so the queue reflects the new voice. SLOW.
  @RequirePermissions('campaigns:write')
  @Post('campaigns/:aimId/redraft-all')
  redraftCampaign(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.campaignReplies.redraftCampaign(orgId, aimId);
  }

  // --- TRAINING (F3): "teach the AI" notes the drafter always applies ---
  @RequirePermissions('campaigns:read')
  @Get('campaigns/:aimId/training')
  listTraining(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.campaignReplies.listTraining(orgId, aimId);
  }

  @RequirePermissions('campaigns:write')
  @Post('campaigns/:aimId/training')
  addTraining(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
    @Body() body: TrainingNoteBodyDto,
  ) {
    return this.campaignReplies.addTraining(orgId, aimId, body.note);
  }

  @RequirePermissions('campaigns:write')
  @Delete('campaign-training/:id')
  removeTraining(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignReplies.removeTraining(orgId, id);
  }

  // --- RE-DRAFT (F3 "Write & Fix"): interactive revision of a draft ---
  @RequirePermissions('campaigns:write')
  @Post('campaign-replies/:id/redraft')
  redraftCampaignReply(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RedraftBodyDto,
  ) {
    return this.campaignReplies.redraftReply(orgId, id, body.instruction);
  }

  // The org's connected Google mailboxes — feeds the inbox account switcher.
  @RequirePermissions('campaigns:read')
  @Get('accounts')
  accounts(@OrgId() orgId: string): Promise<ConnectedGoogleAccountDto[]> {
    return this.engage.listAccounts(orgId);
  }

  // CAMPAIGN-CENTRIC model: the org's campaigns (Reach AIMs) with lead count + the
  // mailbox each sends from (for inbox scoping).
  @RequirePermissions('campaigns:read')
  @Get('campaigns')
  campaigns(@OrgId() orgId: string) {
    return this.engage.listCampaigns(orgId);
  }

  // A campaign's lead folder: each lead + its client email.
  @RequirePermissions('campaigns:read')
  @Get('campaigns/:aimId/leads')
  campaignLeads(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.engage.listCampaignLeads(orgId, aimId);
  }

  // The Gmail threads to/from a lead's client `email`, searched in the campaign's
  // mailbox (`accountId`, optional) or the org default. Requires gmail.readonly.
  @RequirePermissions('campaigns:read')
  @Get('threads')
  threads(
    @OrgId() orgId: string,
    @Query('email') email: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.engage.searchLeadThreads(orgId, email ?? '', accountId);
  }

  // `accountId` (optional) targets a specific connected mailbox; omitted = org default.
  @RequirePermissions('campaigns:read')
  @Get('replies')
  list(
    @OrgId() orgId: string,
    @Query('accountId') accountId?: string,
  ): Promise<EngageReplyListDto> {
    return this.engage.list(orgId, accountId);
  }

  @RequirePermissions('campaigns:write')
  @Post('scan')
  scan(
    @OrgId() orgId: string,
    @Query('accountId') accountId?: string,
  ): Promise<EngageScanResultDto> {
    return this.engage.scan(orgId, accountId);
  }

  @RequirePermissions('campaigns:write')
  @Post('replies/:id/send')
  send(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EngageSendBodyDto,
    @Query('accountId') accountId?: string,
  ): Promise<EngageReplyListDto> {
    return this.engage.send(orgId, id, body.text, accountId);
  }

  @RequirePermissions('campaigns:write')
  @Post('replies/:id/redraft')
  redraft(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('accountId') accountId?: string,
  ): Promise<EngageReplyListDto> {
    return this.engage.redraft(orgId, id, accountId);
  }
}
