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
import { GoogleCalendarReadService } from '../google/google-calendar-read.service';
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
    // The Google-module calendar writer (org default calendar) — used by the Engage
    // booking handoff to create the real Meet event.
    private readonly googleCalendar: GoogleCalendarReadService,
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

  // Book a meeting — the Engage→Activate handoff. Creates a real Google Calendar event
  // (with a Meet link) on the org's DEFAULT calendar mailbox + records a linked meetings
  // row, so the booked call appears in the Booker from the live calendar. Books on the
  // org default calendar (main's createEvent path); per-account targeting is a later
  // refinement (body.accountId is accepted but currently unused). Never silently
  // succeeds — a calendar failure surfaces as a 400 so the operator can fix the grant.
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
  ): Promise<{
    eventId: string;
    joinUrl: string | null;
    title: string;
    meetingDate: string;
  }> {
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

    const created = await this.googleCalendar.createEvent(orgId, {
      title,
      description,
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: 'Europe/Berlin',
      attendees: [{ email: body.clientEmail }],
      addGoogleMeet: true,
    });
    if (!created.ok || !created.eventId) {
      throw new BadRequestException(
        created.reason ??
          'Could not create the calendar event. Confirm a mailbox has granted Calendar access.',
      );
    }

    // The org's default calendar mailbox owns the event (createEvent books there).
    const connected = await this.google.listForOrg(orgId);
    const owner = connected.find((a) => a.isDefault) ?? connected[0];

    await this.repo.createBookedMeeting(orgId, {
      eventId: created.eventId,
      title,
      clientCompany: body.company,
      clientContact: body.contactName?.trim() || null,
      clientEmail: body.clientEmail,
      ownerEmail: owner?.email ?? '',
      meetingDateIso: start.toISOString(),
      joinUrl: created.meetingUrl,
    });

    return {
      eventId: created.eventId,
      joinUrl: created.meetingUrl,
      title,
      meetingDate: start.toISOString(),
    };
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

  // Pull recent Read AI meetings + FULL transcripts via the Read AI API (activate.read_ai_sync
  // agent workflow), upsert them, then auto-analyze any that now have a transcript but no
  // analysis. This is what makes transcription + analysis "come through" without manual steps.
  async syncReadAiFromApi(
    orgId: string,
    limit = 25,
  ): Promise<{ imported: number; analyzed: number; status: string; reason?: string }> {
    const result = await this.agent.run('activate.read_ai_sync', { limit });
    const output = result.output as {
      status?: string;
      reason?: string;
      items?: ReadAiImportItem[];
    };
    if (output.status === 'disabled') {
      this.logger.warn(`Read AI API sync skipped: ${output.reason ?? 'not configured'}`);
      return { imported: 0, analyzed: 0, status: 'disabled', reason: output.reason };
    }
    const items = (output.items ?? []) as ReadAiImportItem[];
    const { count } = items.length
      ? await this.repo.importReadAiMeetings(orgId, items)
      : { count: 0 };
    const analyzed = await this.autoAnalyzePending(orgId);
    this.logger.log(`Read AI API sync: ${count} imported, ${analyzed} auto-analyzed.`);
    return { imported: count, analyzed, status: 'ok' };
  }

  // PUSH path: a finished-meeting report posted by Read AI's webhook (no JWT — gated by
  // the HMAC signature in ReadAiSignatureGuard). Resolves the org from the payload's emails,
  // maps the raw payload → an import item (transcript + summary), upserts it, then
  // auto-analyzes in the BACKGROUND so the webhook acks fast (Read AI retries slow/failed
  // responses, and the local LLM is memory-bound). Logs the raw top-level keys so the
  // mapping can be tuned against the first real fire.
  async ingestReadAiWebhook(payload: Record<string, unknown>): Promise<{
    ok: boolean;
    imported: number;
    sessionId: string | null;
    hasTranscript: boolean;
    orgResolved: boolean;
  }> {
    const body = payload ?? {};
    this.logger.log(`Read AI webhook keys: [${Object.keys(body).join(', ')}]`);

    const { item, emails } = mapReadAiWebhook(body);
    const sessionId = item.readAiId ?? null;
    const hasTranscript = !!item.transcript?.trim();

    const orgId = await this.repo.resolveOrgIdForWebhook(emails);
    if (!orgId) {
      this.logger.warn(
        `Read AI webhook: could not resolve org (emails: [${emails.join(', ')}]).`,
      );
      return { ok: false, imported: 0, sessionId, hasTranscript, orgResolved: false };
    }

    // A bare verification ping (no id and no title) is acknowledged without a write.
    const importable = !!(item.readAiId || item.title);
    const { count } = importable
      ? await this.repo.importReadAiMeetings(orgId, [item])
      : { count: 0 };

    this.logger.log(
      `Read AI webhook: imported ${count} (transcript=${hasTranscript}) for org ${orgId}.`,
    );

    if (count > 0 && hasTranscript) {
      // Fire-and-forget: don't make Read AI wait on the local LLM.
      void this.autoAnalyzePending(orgId).catch((err) =>
        this.logger.warn(
          `Read AI webhook auto-analyze failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }

    return { ok: true, imported: count, sessionId, hasTranscript, orgResolved: true };
  }

  // Analyze every meeting that has a transcript but no analysis yet. Sequential on purpose
  // (the local LLM gateway is memory-bound); best-effort per meeting so one failure doesn't
  // abort the batch. Returns how many were analyzed.
  async autoAnalyzePending(orgId: string): Promise<number> {
    const ids = await this.repo.listMeetingIdsNeedingAnalysis(orgId);
    let analyzed = 0;
    for (const id of ids) {
      try {
        await this.analyzeMeeting(orgId, id);
        analyzed += 1;
      } catch (err) {
        this.logger.warn(
          `Auto-analyze ${id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return analyzed;
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

// ---- Read AI webhook payload mapping (defensive) ----------------------------
// Read AI's webhook body shape isn't a fixed contract, so every field is resolved
// from several candidate paths and the raw keys are logged on each fire (see
// ingestReadAiWebhook) for tuning. All outputs are optional — the import schema is
// lenient and the upsert keys on readAiId (else title+date).

type ReadAiParty = { name?: string; email?: string };

// Resolve the first non-empty string at any of the dotted paths (e.g. 'owner.email').
function digString(obj: unknown, ...paths: string[]): string | undefined {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split('.')) {
      if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
    if (typeof cur === 'number') return String(cur);
  }
  return undefined;
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Read a participant/attendee array, accepting {name,email} objects or bare strings.
function readParties(
  payload: Record<string, unknown>,
  ...keys: string[]
): ReadAiParty[] {
  for (const k of keys) {
    const v = payload[k];
    if (Array.isArray(v)) {
      return v.map((p): ReadAiParty => {
        if (typeof p === 'string') {
          return p.includes('@') ? { email: p } : { name: p };
        }
        const o = (p ?? {}) as Record<string, unknown>;
        const name =
          typeof o.name === 'string'
            ? o.name
            : typeof o.full_name === 'string'
              ? o.full_name
              : undefined;
        const email = typeof o.email === 'string' ? o.email : undefined;
        return { name, email };
      });
    }
  }
  return [];
}

// Flatten Read AI's transcript: a plain string, a {text}, or {speaker_blocks:[...]}.
function transcriptText(payload: Record<string, unknown>): string | undefined {
  const t = payload.transcript;
  if (typeof t === 'string' && t.trim()) return t.trim();
  if (t && typeof t === 'object') {
    const to = t as Record<string, unknown>;
    if (typeof to.text === 'string' && to.text.trim()) return to.text.trim();
    const blocks = to.speaker_blocks ?? to.speakerBlocks ?? to.utterances;
    if (Array.isArray(blocks)) {
      const lines = blocks
        .map((b) => {
          const o = (b ?? {}) as Record<string, unknown>;
          const sp = o.speaker;
          const speaker =
            typeof sp === 'string'
              ? sp
              : sp && typeof sp === 'object' && typeof (sp as Record<string, unknown>).name === 'string'
                ? ((sp as Record<string, unknown>).name as string)
                : typeof o.speaker_name === 'string'
                  ? o.speaker_name
                  : '';
          const words =
            typeof o.words === 'string'
              ? o.words
              : typeof o.text === 'string'
                ? o.text
                : '';
          if (!words.trim()) return '';
          return speaker ? `${speaker}: ${words}` : words;
        })
        .filter(Boolean);
      if (lines.length) return lines.join('\n');
    }
  }
  return undefined;
}

const PUBLIC_EMAIL_ROOTS = new Set([
  'gmail',
  'outlook',
  'hotmail',
  'yahoo',
  'icloud',
  'proton',
  'protonmail',
  'gmx',
  'web',
  'aol',
  'live',
  'me',
]);

// Best-effort company name from a business email domain (skips public providers).
function companyFromEmail(email: string | undefined): string | undefined {
  if (!email || !email.includes('@')) return undefined;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const root = domain.split('.')[0] ?? '';
  if (!root || PUBLIC_EMAIL_ROOTS.has(root)) return undefined;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function mapReadAiWebhook(payload: Record<string, unknown>): {
  item: ReadAiImportItem;
  emails: string[];
} {
  const ownerEmail = digString(
    payload,
    'owner.email',
    'host.email',
    'organizer.email',
    'owner',
  );
  const parties = readParties(payload, 'participants', 'attendees', 'speakers');
  const guest =
    parties.find(
      (p) => p.email && p.email.toLowerCase() !== (ownerEmail ?? '').toLowerCase(),
    ) ?? parties[0];

  const item: ReadAiImportItem = {
    readAiId: digString(payload, 'session_id', 'sessionId', 'id', 'trigger_id'),
    title: digString(payload, 'title', 'session_title', 'meeting_title', 'subject'),
    company: companyFromEmail(guest?.email),
    contact: guest?.name,
    email: guest?.email,
    owner: ownerEmail,
    meetingDate: toIso(
      digString(
        payload,
        'start_time',
        'start',
        'meeting_start_time',
        'startTime',
        'date',
      ),
    ),
    transcript: transcriptText(payload),
    summary: digString(payload, 'summary', 'report.summary', 'summary.text'),
    docUrl: digString(payload, 'report_url', 'session_url', 'report.url', 'url'),
  };

  const emails = [ownerEmail, ...parties.map((p) => p.email)].filter(
    (e): e is string => !!e,
  );
  return { item, emails };
}
