import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import { OrgId } from '../../../common/tenant';
import { ActivateService } from './activate.service';
import { importReadAiSchema } from './dto/import-read-ai.dto';

const analyzeSchema = z.object({ persona: z.string().trim().min(1).optional() });

// The Activate plane for the web UI (Growth stage 03). JWT-protected by the global guard;
// every handler is org-scoped via @OrgId. Meeting Booker reads live Google Calendar; Company
// Research + After-Sales call the erp-agents brains.
@Controller('growth/activate')
export class ActivateController {
  constructor(private readonly activate: ActivateService) {}

  // ---- Meeting Booker ----
  // Connected Google accounts = the email-account toggle (like Engage's inbox switch).
  @Get('meeting-accounts')
  getAccounts(@OrgId() orgId: string) {
    return this.activate.listAccounts(orgId);
  }

  // Upcoming calendar events for one account.
  @Get('meetings')
  getMeetings(@OrgId() orgId: string, @Query('accountId') accountId: string) {
    return this.activate.listMeetings(orgId, accountId ?? '');
  }

  // One event's detail (the popup).
  @Get('meetings/:eventId')
  getMeeting(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.activate.getMeeting(orgId, accountId ?? '', eventId);
  }

  // Request to join — returns the conferencing link to open.
  @Post('meetings/:eventId/join')
  joinMeeting(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.activate.requestToJoin(orgId, accountId ?? '', eventId);
  }

  // ---- Personas ----
  @Get('personas')
  getPersonas(@OrgId() orgId: string) {
    return this.activate.listPersonas(orgId);
  }

  // ---- After-Sales Analysis ----
  // Optionally searchable by name (?q=) and calendar day (?date=YYYY-MM-DD).
  @Get('analyses')
  getAnalyses(
    @OrgId() orgId: string,
    @Query('q') q?: string,
    @Query('date') date?: string,
  ) {
    return this.activate.listAnalyses(orgId, { q, date });
  }

  // Import Read AI meetings (transcripts) into the after-sales store. Body: { meetings: [...] }.
  @Post('read-ai/import')
  importReadAi(@OrgId() orgId: string, @Body() body: unknown) {
    const dto = importReadAiSchema.parse(body);
    return this.activate.importReadAiMeetings(orgId, dto.meetings);
  }

  // Autonomous harvest: pull the meeting list + summaries from Read AI's report emails
  // (Gmail). Transcripts come separately via the import endpoint and merge onto the row.
  @Post('read-ai/harvest')
  harvestReadAi(@OrgId() orgId: string) {
    return this.activate.harvestReadAi(orgId);
  }

  // Score a meeting through the chosen persona (default = the org's first persona).
  @Post('analyses/:meetingId/analyze')
  analyze(
    @OrgId() orgId: string,
    @Param('meetingId') meetingId: string,
    @Body() body: unknown,
  ) {
    const dto = analyzeSchema.parse(body ?? {});
    return this.activate.analyzeMeeting(orgId, meetingId, dto.persona);
  }

  // ---- Company Research ----
  @Get('dossiers')
  getDossiers(@OrgId() orgId: string, @Query('accountId') accountId: string) {
    return this.activate.listDossiers(orgId, accountId ?? '');
  }

  @Post('dossiers/:eventId/generate')
  generateDossier(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.activate.generateDossier(orgId, accountId ?? '', eventId);
  }

  // Dev helper: seed analyzable demo meetings (transcripts) so After-Sales shows DB data.
  @Post('demo-seed')
  demoSeed(@OrgId() orgId: string) {
    return this.activate.seedDemo(orgId);
  }
}
