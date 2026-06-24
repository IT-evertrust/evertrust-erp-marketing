import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { CreateAimBodyDto, SetAutoSendBodyDto } from './dto/create-aim.dto';
import {
  CreateReachLeadBodyDto,
  UpdateReachLeadDealBodyDto,
  UpdateReachLeadStageBodyDto,
} from './dto/nurture-board.dto';
import {
  ReachTestSendBodyDto,
  UpdateReachSettingsBodyDto,
} from './dto/reach-settings.dto';
import type { ReachRound } from './reach.model';
import { ReachService } from './reach.service';

const ROUNDS: ReachRound[] = ['cold', 'followup', 'final'];

// 1x1 transparent GIF — the open-tracking pixel.
const TRACK_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

// The Reach plane (Growth Engine) for the web UI. JWT-auth + tenant-scoped (@OrgId),
// gated by the campaigns RBAC (read for queries, write for create/scrape/send/toggle)
// like Engage + the Gmail read endpoints. JwtAuthGuard + PermissionsGuard are global
// (APP_GUARD) — no @UseGuards here. The track/* endpoints are @Public (hit by email
// clients with no auth). An "aim" is a Reach campaign.
@Controller('growth/reach')
export class ReachController {
  constructor(private readonly reachService: ReachService) {}

  @RequirePermissions('campaigns:read')
  @Get('aims')
  getAims(@OrgId() orgId: string) {
    return this.reachService.getAims(orgId);
  }

  // Real daily email-send counts (last 10 days ending today) for the reach chart.
  @RequirePermissions('campaigns:read')
  @Get('daily-sends')
  getDailySends(@OrgId() orgId: string) {
    return this.reachService.dailySends(orgId);
  }

  @RequirePermissions('campaigns:read')
  @Get('aims/:aimId')
  getAim(@OrgId() orgId: string, @Param('aimId') aimId: string) {
    return this.reachService.getAim(orgId, aimId);
  }

  // AIM: create the campaign (config.json) + generate templates + news brief. The
  // body is validated by the global ZodValidationPipe against CreateAimBodyDto.
  @RequirePermissions('campaigns:write')
  @Post('aims')
  createAim(@OrgId() orgId: string, @Body() body: CreateAimBodyDto) {
    return this.reachService.createAim(orgId, body);
  }

  // Activate Lead Satellite for this aim's config; returns the scraped leads.
  @RequirePermissions('campaigns:write')
  @Post('aims/:aimId/scrape')
  scrapeAim(@OrgId() orgId: string, @Param('aimId') aimId: string) {
    return this.reachService.scrapeAim(orgId, aimId);
  }

  @RequirePermissions('campaigns:read')
  @Get('aims/:aimId/leads')
  getAimLeads(@OrgId() orgId: string, @Param('aimId') aimId: string) {
    return this.reachService.getAimLeads(orgId, aimId);
  }

  // ---- Nurture board (reach_leads ARE the pipeline cards) ----

  // The Nurture pipeline. Optional ?aimId scopes to one campaign (omit = all org
  // leads, the "All campaigns" view). ?q filters by company substring.
  @RequirePermissions('campaigns:read')
  @Get('board')
  board(
    @OrgId() orgId: string,
    @Query('aimId') aimId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reachService.board(orgId, {
      aimId: aimId || undefined,
      q: q || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  // Drag a lead to another pipeline stage. org-scoped + audited.
  @RequirePermissions('campaigns:write')
  @Patch('leads/:leadId/stage')
  async updateLeadStage(
    @OrgId() orgId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: UpdateReachLeadStageBodyDto,
    @Req() req: Request,
  ) {
    const lead = await this.reachService.updateLeadStage(orgId, leadId, body.stage);
    setAuditContext(req, {
      entity: 'reach_leads',
      entityId: leadId,
      action: 'UPDATE_PIPELINE_STAGE',
      after: { stage: body.stage },
    });
    return lead;
  }

  // Add a Nurture card under an aim (the board's "+ Add deal"). org-scoped + audited.
  @RequirePermissions('campaigns:write')
  @Post('leads')
  async createLead(
    @OrgId() orgId: string,
    @Body() body: CreateReachLeadBodyDto,
    @Req() req: Request,
  ) {
    const lead = await this.reachService.createLead(orgId, body);
    setAuditContext(req, {
      entity: 'reach_leads',
      entityId: lead.id,
      action: 'CREATE_DEAL',
      after: { aimId: body.aimId, stage: lead.pipelineStage },
    });
    return lead;
  }

  // Delete a Nurture card (the × on hover). org-scoped + audited.
  @RequirePermissions('campaigns:write')
  @Delete('leads/:leadId')
  async deleteLead(
    @OrgId() orgId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Req() req: Request,
  ) {
    const result = await this.reachService.deleteLead(orgId, leadId);
    setAuditContext(req, {
      entity: 'reach_leads',
      entityId: leadId,
      action: 'DELETE_DEAL',
    });
    return result;
  }

  // Inline-edit a lead's deal value / contact fields. org-scoped + audited.
  @RequirePermissions('campaigns:write')
  @Patch('leads/:leadId/deal')
  async updateLeadDeal(
    @OrgId() orgId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: UpdateReachLeadDealBodyDto,
    @Req() req: Request,
  ) {
    const lead = await this.reachService.updateLeadDeal(orgId, leadId, {
      company: body.company,
      dealValue: body.dealValue,
      contactName: body.contactName,
      phone: body.contactPhone,
    });
    setAuditContext(req, {
      entity: 'reach_leads',
      entityId: leadId,
      action: 'UPDATE_DEAL',
      after: { dealValue: lead.dealValue },
    });
    return lead;
  }

  // Manual send for one round (cold | followup | final). Records the send +
  // advances stats; actual Gmail delivery is deferred until the OAuth key lands.
  @RequirePermissions('campaigns:write')
  @Post('aims/:aimId/send/:round')
  sendRound(
    @OrgId() orgId: string,
    @Param('aimId') aimId: string,
    @Param('round') round: string,
  ) {
    if (!ROUNDS.includes(round as ReachRound)) {
      throw new BadRequestException(
        `Invalid round '${round}' (expected cold | followup | final).`,
      );
    }
    return this.reachService.sendRound(orgId, aimId, round as ReachRound);
  }

  // ---- Reach Bazooka (auto-sender) ----

  // Toggle a campaign's auto-send on/off. The body is validated by the global
  // ZodValidationPipe against SetAutoSendBodyDto ({ enabled: boolean }).
  @RequirePermissions('campaigns:write')
  @Patch('aims/:aimId/auto-send')
  setAutoSend(
    @OrgId() orgId: string,
    @Param('aimId') aimId: string,
    @Body() body: SetAutoSendBodyDto,
  ) {
    return this.reachService.setAutoSend(orgId, aimId, body.enabled);
  }

  // Run Bazooka now: advance every auto-send campaign by its next due round.
  @RequirePermissions('campaigns:write')
  @Post('bazooka/run')
  runBazooka(@OrgId() orgId: string) {
    return this.reachService.runBazooka(orgId);
  }

  // ---- Reach send-policy settings (Settings page) ----

  // The org's effective Reach send policy + env defaults + mailbox status.
  @RequirePermissions('campaigns:read')
  @Get('settings')
  getSettings(@OrgId() orgId: string) {
    return this.reachService.getReachSendSettings(orgId);
  }

  // Update the per-org send policy (test/live, test recipient, cap). Body validated
  // by the global ZodValidationPipe against UpdateReachSettingsBodyDto.
  @RequirePermissions('campaigns:write')
  @Patch('settings')
  updateSettings(
    @OrgId() orgId: string,
    @Body() body: UpdateReachSettingsBodyDto,
  ) {
    return this.reachService.updateReachSendSettings(orgId, body);
  }

  // Send a one-off sample email to the given inbox to verify outbound sending.
  @RequirePermissions('campaigns:write')
  @Post('settings/test-send')
  testSend(@OrgId() orgId: string, @Body() body: ReachTestSendBodyDto) {
    return this.reachService.sendTestEmail(orgId, body.to);
  }

  // ---- tracking (public; hit by email clients / links, no auth) ----

  // Open pixel: records an open for (aim, round, lead) and returns a 1x1 GIF.
  @Public()
  @Get('track/open/:aimId/:round/:leadId')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store')
  async trackOpen(
    @Param('aimId') aimId: string,
    @Param('round') round: string,
    @Param('leadId') leadId: string,
  ): Promise<Buffer> {
    if (ROUNDS.includes(round as ReachRound)) {
      await this.reachService.track(aimId, round as ReachRound, leadId, 'open');
    }
    return TRACK_PIXEL;
  }

  // Click redirect: records a click, then 302s to the ?url= target.
  @Public()
  @Get('track/click/:aimId/:round/:leadId')
  @Redirect('https://www.evertrust-germany.de', 302)
  async trackClick(
    @Param('aimId') aimId: string,
    @Param('round') round: string,
    @Param('leadId') leadId: string,
    @Query('url') url?: string,
  ): Promise<{ url: string }> {
    if (ROUNDS.includes(round as ReachRound)) {
      await this.reachService.track(aimId, round as ReachRound, leadId, 'click');
    }
    return { url: url || 'https://www.evertrust-germany.de' };
  }

  // Reply webhook: records a reply for (aim, round, lead).
  @Public()
  @Post('track/reply/:aimId/:round/:leadId')
  async trackReply(
    @Param('aimId') aimId: string,
    @Param('round') round: string,
    @Param('leadId') leadId: string,
  ): Promise<{ ok: boolean }> {
    if (!ROUNDS.includes(round as ReachRound)) {
      throw new BadRequestException(`Invalid round '${round}'.`);
    }
    const ok = await this.reachService.track(
      aimId,
      round as ReachRound,
      leadId,
      'reply',
    );
    return { ok };
  }
}
