import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

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
        color: a.color ?? null,
      }));
    }
    return (await this.repo.listMeetingOwners(orgId)).map((o) => ({
      ...o,
      color: null,
    }));
  }

  // Upcoming events for one connected mailbox's calendar. accountId is a google_accounts id;
  // empty selects the newest grant. `'all'` aggregates EVERY connected account's calendar.
  // Falls back to DB-seeded meetings with no Google account. Each meeting carries its owning
  // account's id/email/color so the UI can color-code per account.
  async listMeetings(orgId: string, accountId: string): Promise<ActivateMeeting[]> {
    const connected = await this.google.listForOrg(orgId);

    // All-accounts mode: read every connected calendar and merge, tagging each event
    // with its owning account's color.
    if (accountId === 'all' && connected.length > 0) {
      const perAccount = await Promise.all(
        connected.map(async (a) => {
          const events = await this.calendar.listUpcoming(orgId, a.id);
          return events.map((m) => this.tagAccount(m, a));
        }),
      );
      return perAccount.flat();
    }

    const resolvedId =
      accountId && connected.some((a) => a.id === accountId)
        ? accountId
        : connected[0]?.id ?? null;
    if (!resolvedId) {
      return this.repo.listUpcomingMeetings(orgId, accountId || undefined);
    }
    const account = connected.find((a) => a.id === resolvedId);
    const events = await this.calendar.listUpcoming(orgId, resolvedId);
    return account ? events.map((m) => this.tagAccount(m, account)) : events;
  }

  // Edit a meeting in place on its account's calendar. Returns the updated, account-tagged
  // meeting. accountId must be a real connected account (resolved to the newest if blank).
  async updateMeeting(
    orgId: string,
    accountId: string,
    eventId: string,
    patch: {
      title?: string;
      description?: string | null;
      location?: string | null;
      start?: string;
      end?: string;
    },
  ): Promise<ActivateMeeting> {
    const connected = await this.google.listForOrg(orgId);
    const account =
      connected.find((a) => a.id === accountId) ?? connected[0];
    if (!account) throw new BadRequestException('No connected calendar account.');
    const updated = await this.calendar.updateEvent(orgId, account.id, eventId, patch);
    if (!updated) throw new BadRequestException('Could not update the meeting.');
    return this.tagAccount(updated, account);
  }

  // Move a meeting from one connected account's calendar to another (copy to target +
  // delete from source). Returns the new meeting on the target account.
  async moveMeeting(
    orgId: string,
    eventId: string,
    fromAccountId: string,
    toAccountId: string,
  ): Promise<ActivateMeeting> {
    const connected = await this.google.listForOrg(orgId);
    const from = connected.find((a) => a.id === fromAccountId);
    const to = connected.find((a) => a.id === toAccountId);
    if (!from || !to) throw new BadRequestException('Unknown source or target account.');
    if (from.id === to.id) throw new BadRequestException('Source and target are the same account.');
    const moved = await this.calendar.moveEvent(orgId, eventId, from.id, to.id);
    if (!moved) throw new BadRequestException('Could not move the meeting.');
    return this.tagAccount(moved, to);
  }

  // Book a meeting (the Engage→Activate handoff). Creates a real Google Calendar event
  // — with the client invited + a Google Meet link — on the chosen mailbox's calendar,
  // records a linked meetings row, and returns the account-tagged meeting. The event
  // shows up in the Booker on the next calendar read (it's a live event). Throws a
  // user-facing 400 if the mailbox lacks Calendar access or the API rejects.
  async bookMeeting(
    orgId: string,
    body: {
      company: string;
      contactName?: string;
      clientEmail: string;
      startsAt: string;
      durationMinutes?: number;
      title?: string;
      notes?: string;
      accountId?: string;
    },
  ): Promise<ActivateMeeting> {
    const access = await this.google.resolveMailboxForAccount(
      orgId,
      body.accountId ?? null,
      'calendar',
    );
    if (!access.ok) throw new BadRequestException(access.reason);

    const start = new Date(body.startsAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid meeting start time.');
    }
    const duration = body.durationMinutes ?? 30;
    const end = new Date(start.getTime() + duration * 60_000);
    const title = body.title?.trim() || `EVERTRUST × ${body.company} — Intro Call`;
    const description = [body.notes?.trim(), 'Booked via EVERTRUST Engage.']
      .filter(Boolean)
      .join('\n\n');

    const created = await this.calendar.createEvent(orgId, access.account.id, {
      summary: title,
      description,
      start: start.toISOString(),
      end: end.toISOString(),
      attendees: [body.clientEmail],
      requestId: `engage-${randomUUID()}`,
      withMeet: true,
    });
    if (!created) {
      throw new BadRequestException(
        `Could not create the calendar event on ${access.account.email}. Confirm the mailbox has granted Calendar access.`,
      );
    }

    await this.repo.createBookedMeeting(orgId, {
      eventId: created.id,
      title,
      clientCompany: body.company,
      clientContact: body.contactName?.trim() || null,
      clientEmail: body.clientEmail,
      ownerEmail: access.account.email,
      meetingDateIso: start.toISOString(),
      joinUrl: created.joinUrl,
    });

    const connected = await this.google.listForOrg(orgId);
    const account = connected.find((a) => a.id === access.account.id);
    return account ? this.tagAccount(created, account) : created;
  }

  // Stamp an event with its owning account's id/email/color (for per-account coloring).
  private tagAccount(
    m: ActivateMeeting,
    account: { id: string; email: string; color: string | null },
  ): ActivateMeeting {
    return {
      ...m,
      accountId: account.id,
      accountEmail: account.email,
      accountColor: account.color ?? null,
    };
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
  ): Promise<{ scanned: number; imported: number; reason: string | null }> {
    const { items, scanned, errors } = await this.readAiEmail.harvest(orgId);
    const { count } = await this.repo.importReadAiMeetings(orgId, items);
    if (count > 0) {
      this.logger.log(`Read AI harvest: ${count} meetings upserted from ${scanned} report emails.`);
    }
    // Surface a reason when nothing was imported so the UI can explain the failure
    // (e.g. a metadata-only Gmail grant blocking search) rather than a silent "Synced 0".
    const reason =
      count === 0 && errors.length > 0
        ? errors.join(' · ')
        : count === 0
          ? 'No Read AI report emails found in the connected mailboxes.'
          : null;
    return { scanned, imported: count, reason };
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
