import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ActivateAgentClient } from './activate.agent';
import { ActivateRepository } from './activate.repository';
import { CalendarReaderService } from './calendar-reader.service';
import { ReadAiEmailService } from './read-ai-email.service';
import { GoogleAccountsService } from '../google/google-accounts.service';
import type { ReadAiImportItem } from './dto/import-read-ai.dto';
import type {
  ActivateCallAnalysis,
  ActivateDossier,
  ActivateMeeting,
  ActivateMeetingAccount,
  ActivatePersona,
} from './activate.model';

// Activate orchestration. Meeting Booker + Company Research read DB-seeded meetings; Company
// Research + After-Sales call the erp-agents brains and persist/cache here.
@Injectable()
export class ActivateService {
  private readonly logger = new Logger(ActivateService.name);
  // Pre-meeting dossiers are generated on demand and cached per (org, meeting) — no new table.
  private readonly dossierCache = new Map<string, ActivateDossier>();

  constructor(
    private readonly repo: ActivateRepository,
    private readonly agent: ActivateAgentClient,
    private readonly calendar: CalendarReaderService,
    private readonly google: GoogleAccountsService,
    private readonly readAiEmail: ReadAiEmailService,
  ) {}

  // ---- Meeting Booker (live Google Calendar) ----
  // The connected Google mailboxes = the email-account toggle (info | hanna). Falls back to
  // the DB-seeded meeting owners when no Google account is connected (dev / no-OAuth mode).
  async listAccounts(orgId: string): Promise<ActivateMeetingAccount[]> {
    const connected = await this.google.listForOrg(orgId);
    if (connected.length > 0) {
      return connected.map((a) => ({
        id: a.id,
        email: a.email,
        displayName: a.displayName,
        status: a.status,
      }));
    }
    return this.repo.listMeetingOwners(orgId);
  }

  // Upcoming events for one connected mailbox's calendar. accountId is a google_accounts id;
  // empty selects the newest grant. Falls back to DB-seeded meetings with no Google account.
  async listMeetings(orgId: string, accountId: string): Promise<ActivateMeeting[]> {
    const account = await this.resolveAccountId(orgId, accountId);
    if (!account) return this.repo.listUpcomingMeetings(orgId, accountId || undefined);
    return this.calendar.listUpcoming(orgId, account);
  }

  async getMeeting(
    orgId: string,
    accountId: string,
    eventId: string,
  ): Promise<ActivateMeeting> {
    const account = await this.resolveAccountId(orgId, accountId);
    if (account) {
      const event = await this.calendar.getEvent(orgId, account, eventId);
      if (event) return event;
    }
    // No live calendar (or event not found there) — try the DB-seeded meeting.
    return this.repo.getUpcomingMeeting(orgId, eventId);
  }

  // "Request to join": hand back the meeting's conferencing link so the UI can open it.
  async requestToJoin(
    orgId: string,
    accountId: string,
    eventId: string,
  ): Promise<{ status: 'ok' | 'no_link'; joinUrl: string | null; htmlLink: string | null }> {
    const meeting = await this.getMeeting(orgId, accountId, eventId);
    return {
      status: meeting.joinUrl ? 'ok' : 'no_link',
      joinUrl: meeting.joinUrl,
      htmlLink: meeting.htmlLink,
    };
  }

  // Resolve a requested account id to a connected google_accounts id, defaulting to the
  // newest grant. null when the org has no connected Google mailbox (DB-fallback signal).
  private async resolveAccountId(
    orgId: string,
    accountId: string,
  ): Promise<string | null> {
    const connected = await this.google.listForOrg(orgId);
    if (accountId && connected.some((a) => a.id === accountId)) return accountId;
    return connected[0]?.id ?? null;
  }

  // ---- Personas ----
  listPersonas(orgId: string): Promise<ActivatePersona[]> {
    return this.repo.listPersonas(orgId);
  }

  // ---- After-Sales Analysis ----
  // Analyzable calls (those with a stored transcript), optionally searched by name + date.
  listAnalyses(
    orgId: string,
    opts?: { q?: string; date?: string },
  ): Promise<ActivateCallAnalysis[]> {
    return this.repo.listAnalyzableMeetings(orgId, opts);
  }

  // Import Read AI meetings (transcripts) into the after-sales store. Read AI owns the
  // transcript; we keep our own copy + analysis. Upsert keyed on the Read AI ULID.
  importReadAiMeetings(
    orgId: string,
    items: ReadAiImportItem[],
  ): Promise<{ count: number }> {
    return this.repo.importReadAiMeetings(orgId, items);
  }

  // Autonomous harvest: pull every Read AI meeting's title/date/summary from the connected
  // mailboxes' "Read Meeting Report" emails and upsert them (transcript pending). Idempotent.
  async harvestReadAi(
    orgId: string,
  ): Promise<{ scanned: number; imported: number }> {
    const { items, scanned } = await this.readAiEmail.harvest(orgId);
    const { count } = await this.repo.importReadAiMeetings(orgId, items);
    if (count > 0) {
      this.logger.log(`Read AI harvest: ${count} meetings upserted from ${scanned} report emails.`);
    }
    return { scanned, imported: count };
  }

  // Score one meeting's transcript through the chosen persona via activate.sales_agent, then
  // persist the analysis onto the meeting and return the refreshed UI shape.
  async analyzeMeeting(
    orgId: string,
    meetingId: string,
    personaName?: string,
  ): Promise<ActivateCallAnalysis> {
    const meeting = await this.repo.requireMeeting(orgId, meetingId);
    if (!meeting.transcript) {
      throw new BadRequestException(
        'No transcript stored for this meeting — nothing to analyze.',
      );
    }
    const persona = await this.repo.resolvePersona(orgId, personaName);
    const result = await this.agent.run('activate.sales_agent', {
      transcript: meeting.transcript,
      persona_name: persona.name,
      persona_prompt: persona.prompt,
      source: 'erp',
    });
    const output = result.output;
    if (output.status !== 'ok' || typeof output.analysis !== 'object' || output.analysis === null) {
      const reason = typeof output.reason === 'string' ? output.reason : String(output.status);
      throw new BadRequestException(`Sales analysis could not be produced (${reason}).`);
    }
    return this.repo.saveAnalysis(
      orgId,
      meetingId,
      persona.name,
      output.analysis as Record<string, unknown>,
    );
  }

  // ---- Company Research ----
  // Upcoming meetings (DB-seeded) as research targets. Each carries a cached dossier if we've
  // generated one, else 'Being generated' until the user opens it.
  async listDossiers(orgId: string, accountId: string): Promise<ActivateDossier[]> {
    const meetings = await this.listMeetings(orgId, accountId);
    // Research targets are UPCOMING meetings only (the calendar window also returns recent
    // past meetings for the Booker's week-nav, which aren't research targets).
    const now = Date.now();
    const upcoming = meetings.filter(
      (m) => !m.startsAt || Date.parse(m.startsAt) >= now,
    );
    return upcoming.map((m) => this.dossierShell(orgId, m));
  }

  // Generate (or return the cached) dossier for one upcoming meeting via activate.company_research.
  async generateDossier(
    orgId: string,
    _accountId: string,
    eventId: string,
  ): Promise<ActivateDossier> {
    const cached = this.dossierCache.get(this.cacheKey(orgId, eventId));
    if (cached) return cached;
    const meeting = await this.getMeeting(orgId, _accountId, eventId);
    if (!meeting) throw new NotFoundException('Meeting not found');

    const context = await this.repo.companyContext(orgId, meeting.company);
    const knownFacts = [...context.knownFacts];
    if (meeting.description) knownFacts.push(meeting.description.slice(0, 300));

    const result = await this.agent.run('activate.company_research', {
      company: meeting.company,
      contact: meeting.contact,
      country: context.country,
      region: context.region,
      niche: context.niche,
      product_or_service: context.productOrService,
      meeting_time: this.meetingTime(meeting),
      known_facts: knownFacts,
    });
    const output = result.output;
    const dossier: ActivateDossier = {
      id: meeting.id,
      company: meeting.company,
      contact: meeting.contact,
      meetingTime: this.meetingTime(meeting),
      status: 'Dossier ready',
      profile: (Array.isArray(output.profile) ? output.profile : []).map((p) => {
        const o = p as { label?: unknown; value?: unknown };
        return { label: String(o.label ?? ''), value: String(o.value ?? '') };
      }),
      signals: (Array.isArray(output.signals) ? output.signals : []).map((s) => String(s)),
      talkingPoints: (Array.isArray(output.talking_points) ? output.talking_points : []).map((t) =>
        String(t),
      ),
    };
    this.dossierCache.set(this.cacheKey(orgId, eventId), dossier);
    return dossier;
  }

  // ---- demo seed ----
  seedDemo(orgId: string): Promise<{ created: number; skipped: number }> {
    return this.repo.seedDemoMeetings(orgId);
  }

  // ---- helpers ----
  private dossierShell(orgId: string, m: ActivateMeeting): ActivateDossier {
    const cached = this.dossierCache.get(this.cacheKey(orgId, m.id));
    if (cached) return cached;
    return {
      id: m.id,
      company: m.company,
      contact: m.contact,
      meetingTime: this.meetingTime(m),
      status: 'Being generated',
      profile: [],
      signals: [],
      talkingPoints: [],
    };
  }

  private meetingTime(m: ActivateMeeting): string {
    if (!m.startsAt) return m.day || 'Upcoming';
    const d = new Date(m.startsAt);
    if (Number.isNaN(d.getTime())) return m.day || 'Upcoming';
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    return `${weekday} ${m.time}`;
  }

  private cacheKey(orgId: string, eventId: string): string {
    return `${orgId}:${eventId}`;
  }
}
