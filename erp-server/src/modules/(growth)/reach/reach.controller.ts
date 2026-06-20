import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Patch,
  Query,
  Redirect,
} from '@nestjs/common';

import { Public } from '../../../auth/decorators/public.decorator';
import { OrgId } from '../../../common/tenant';
import { createAimSchema, type CreateAimDto } from './dto/create-aim.dto';
import type { ReachRound } from './reach.model';
import { ReachService } from './reach.service';

const ROUNDS: ReachRound[] = ['cold', 'followup', 'final'];

// 1x1 transparent GIF — the open-tracking pixel.
const TRACK_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

// The Reach plane for the web UI. JWT-protected by the global guard; every handler
// is org-scoped via @OrgId. An "aim" is a Reach campaign.
@Controller('growth/reach')
export class ReachController {
  constructor(private readonly reachService: ReachService) {}

  @Get('aims')
  getAims(@OrgId() orgId: string) {
    return this.reachService.getAims(orgId);
  }

  @Get('aims/:aimId')
  getAim(@OrgId() orgId: string, @Param('aimId') aimId: string) {
    return this.reachService.getAim(orgId, aimId);
  }

  // AIM: create the campaign (config.json) + generate templates + news brief.
  @Post('aims')
  createAim(@OrgId() orgId: string, @Body() body: CreateAimDto) {
    const dto = createAimSchema.parse(body);
    return this.reachService.createAim(orgId, dto);
  }

  // Activate Lead Satellite for this aim's config; returns the scraped leads.
  @Post('aims/:aimId/scrape')
  scrapeAim(@OrgId() orgId: string, @Param('aimId') aimId: string) {
    return this.reachService.scrapeAim(orgId, aimId);
  }

  @Get('aims/:aimId/leads')
  getAimLeads(@OrgId() orgId: string, @Param('aimId') aimId: string) {
    return this.reachService.getAimLeads(orgId, aimId);
  }

  // Manual send for one round (cold | followup | final). Records the send +
  // advances stats; actual Gmail delivery is deferred until the OAuth key lands.
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

  // Toggle a campaign's auto-send on/off.
  @Patch('aims/:aimId/auto-send')
  setAutoSend(
    @OrgId() orgId: string,
    @Param('aimId') aimId: string,
    @Body() body: { enabled?: unknown },
  ) {
    return this.reachService.setAutoSend(orgId, aimId, body?.enabled === true);
  }

  // Run Bazooka now: advance every auto-send campaign by its next due round.
  @Post('bazooka/run')
  runBazooka(@OrgId() orgId: string) {
    return this.reachService.runBazooka(orgId);
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
