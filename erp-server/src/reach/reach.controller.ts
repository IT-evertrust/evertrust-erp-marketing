import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Patch,
  Put,
  Query,
  Redirect,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { CreateAimBodyDto, SetAutoSendBodyDto } from './dto/create-aim.dto';
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

  // ---- Org default outreach template (paste/upload + set default) ----
  @RequirePermissions('campaigns:write')
  @Get('default-template')
  getDefaultTemplate(@OrgId() orgId: string) {
    return this.reachService.getDefaultTemplate(orgId);
  }

  // Accepts a pasted template in any round spelling (COLD/FOLLOWUP/FINALPUSH or the
  // stored keys); the service normalizes + validates and 400s on a bad shape.
  @RequirePermissions('campaigns:write')
  @Put('default-template')
  async setDefaultTemplate(@OrgId() orgId: string, @Body() body: unknown) {
    await this.reachService.setDefaultTemplate(orgId, body);
    return { ok: true };
  }

  // ---- Signature image embedded in every outgoing email (org_config; the image
  // itself is uploaded/served by the arsenal SignatureAssetsService) ----
  @RequirePermissions('campaigns:write')
  @Get('signature')
  async getSignature(@OrgId() orgId: string) {
    return { signatureImageUrl: await this.reachService.getSignatureImageUrl(orgId) };
  }

  @RequirePermissions('campaigns:write')
  @Put('signature')
  async setSignature(@OrgId() orgId: string, @Body() body: { url?: string | null }) {
    await this.reachService.setSignatureImageUrl(orgId, body?.url ?? null);
    return { ok: true };
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
  createAim(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CreateAimBodyDto,
  ) {
    // Pass the creating user so the linked campaign records who owns it
    // (campaigns.activatedBy) — that drives the PER-USER sender identity on send.
    return this.reachService.createAim(orgId, body, user.id);
  }

  // Activate Lead Satellite for this aim's config. The scrape runs in the BACKGROUND
  // (it can take minutes) — this returns the aim marked RUNNING with a server-seeded
  // ETA immediately; the FE polls getAims for completion + renders the countdown.
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

  // ---- Reach send timeline + send-policy settings (Settings page) ----

  // Real per-day Reach send counts over the last 10 days (drives the dashboard chart).
  @RequirePermissions('campaigns:read')
  @Get('daily-sends')
  dailySends(@OrgId() orgId: string) {
    return this.reachService.dailySends(orgId);
  }

  // The org's effective send policy + env defaults + mailbox status.
  @RequirePermissions('campaigns:read')
  @Get('settings')
  getSettings(@OrgId() orgId: string) {
    return this.reachService.getReachSendSettings(orgId);
  }

  // Update the per-org send policy (test/live, test recipient, cap). Validated by the
  // global ZodValidationPipe against UpdateReachSettingsBodyDto.
  @RequirePermissions('campaigns:write')
  @Patch('settings')
  updateSettings(@OrgId() orgId: string, @Body() body: UpdateReachSettingsBodyDto) {
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
