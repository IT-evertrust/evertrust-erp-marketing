import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { ActivateService } from './activate.service';
import {
  AnalyzeMeetingBodyDto,
  ImportReadAiBodyDto,
} from './dto/import-read-ai.dto';

// The Activate plane (Growth Engine, stage 03) for the web UI. JWT-auth + tenant-scoped
// (@OrgId), gated by the campaigns RBAC (read for queries, write for mutations) like
// Reach/Engage + the Gmail/Calendar read endpoints. JwtAuthGuard + PermissionsGuard are
// global (APP_GUARD) — no @UseGuards here. Meeting Booker reads live Google Calendar;
// Company Research + After-Sales call the erp-agents brains.
@Controller('growth/activate')
export class ActivateController {
  constructor(private readonly activate: ActivateService) {}

  // ---- Meeting Booker ----
  // Connected Google accounts = the email-account toggle (like Engage's inbox switch).
  @RequirePermissions('campaigns:read')
  @Get('meeting-accounts')
  getAccounts(@OrgId() orgId: string) {
    return this.activate.listAccounts(orgId);
  }

  // Upcoming calendar events for one account.
  @RequirePermissions('campaigns:read')
  @Get('meetings')
  getMeetings(@OrgId() orgId: string, @Query('accountId') accountId: string) {
    return this.activate.listMeetings(orgId, accountId ?? '');
  }

  // One event's detail (the popup).
  @RequirePermissions('campaigns:read')
  @Get('meetings/:eventId')
  getMeeting(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.activate.getMeeting(orgId, accountId ?? '', eventId);
  }

  // Request to join — returns the conferencing link to open.
  @RequirePermissions('campaigns:write')
  @Post('meetings/:eventId/join')
  joinMeeting(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.activate.requestToJoin(orgId, accountId ?? '', eventId);
  }

  // ---- Personas ----
  @RequirePermissions('campaigns:read')
  @Get('personas')
  getPersonas(@OrgId() orgId: string) {
    return this.activate.listPersonas(orgId);
  }

  // ---- After-Sales Analysis ----
  // Optionally searchable by name (?q=) and calendar day (?date=YYYY-MM-DD).
  @RequirePermissions('campaigns:read')
  @Get('analyses')
  getAnalyses(
    @OrgId() orgId: string,
    @Query('q') q?: string,
    @Query('date') date?: string,
  ) {
    return this.activate.listAnalyses(orgId, { q, date });
  }

  // Import Read AI meetings (transcripts) into the after-sales store. Body: { meetings: [...] }.
  // The body is validated by the global ZodValidationPipe against ImportReadAiBodyDto.
  @RequirePermissions('campaigns:write')
  @Post('read-ai/import')
  importReadAi(@OrgId() orgId: string, @Body() body: ImportReadAiBodyDto) {
    return this.activate.importReadAiMeetings(orgId, body.meetings);
  }

  // Autonomous harvest: pull the meeting list + summaries from Read AI's report emails
  // (Gmail). Transcripts come separately via the import endpoint and merge onto the row.
  @RequirePermissions('campaigns:write')
  @Post('read-ai/harvest')
  harvestReadAi(@OrgId() orgId: string) {
    return this.activate.harvestReadAi(orgId);
  }

  // Score a meeting through the chosen persona (default = the org's first persona). The body
  // is validated by the global ZodValidationPipe against AnalyzeMeetingBodyDto.
  @RequirePermissions('campaigns:write')
  @Post('analyses/:meetingId/analyze')
  analyze(
    @OrgId() orgId: string,
    @Param('meetingId') meetingId: string,
    @Body() body: AnalyzeMeetingBodyDto,
  ) {
    return this.activate.analyzeMeeting(orgId, meetingId, body.persona);
  }

  // ---- Company Research ----
  @RequirePermissions('campaigns:read')
  @Get('dossiers')
  getDossiers(@OrgId() orgId: string, @Query('accountId') accountId: string) {
    return this.activate.listDossiers(orgId, accountId ?? '');
  }

  @RequirePermissions('campaigns:write')
  @Post('dossiers/:eventId/generate')
  generateDossier(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.activate.generateDossier(orgId, accountId ?? '', eventId);
  }

  // Dev helper: seed analyzable demo meetings (transcripts) so After-Sales shows DB data.
  @RequirePermissions('campaigns:write')
  @Post('demo-seed')
  demoSeed(@OrgId() orgId: string) {
    return this.activate.seedDemo(orgId);
  }
}
