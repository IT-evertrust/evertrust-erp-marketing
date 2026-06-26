import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import {
  DEFAULT_PERSONA_NAME,
  DEFAULT_PERSONA_PROMPT,
} from '../meetings/meetings.analysis';
import type { ReadAiImportItem } from './dto/import-read-ai.dto';
import type {
  ActivateCallAnalysis,
  ActivateMeeting,
  ActivateMeetingAccount,
  ActivatePersona,
} from './activate.model';

type MeetingRow = typeof schema.meetings.$inferSelect;

// Context the Company Research agent needs, gathered from the prospect/campaign the meeting's
// company best matches. All optional — the agent grounds on whatever is present.
export interface CompanyContext {
  country: string | null;
  region: string | null;
  niche: string | null;
  productOrService: string | null;
  knownFacts: string[];
}

// Reads + writes for the Activate plane: PG personas (auto-provisioned), the after-sales
// meetings/analysis store, and the light company-context lookup for research. All org-scoped.
@Injectable()
export class ActivateRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // ---- Read AI webhook org resolution ----
  // A public Read AI webhook carries no tenant. Resolve the org from the meeting's
  // participant/owner emails (match any to a users.email), falling back to the single
  // organization — this is a one-org internal app. Returns null only when no email
  // matches AND there is more than one org (ambiguous), so the caller can 400.
  async resolveOrgIdForWebhook(emails: string[]): Promise<string | null> {
    const cleaned = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(
      Boolean,
    );
    if (cleaned.length > 0) {
      const rows = await this.db
        .select({ orgId: schema.users.organizationId })
        .from(schema.users)
        .where(inArray(schema.users.email, cleaned))
        .limit(1);
      if (rows[0]) return rows[0].orgId;
    }
    const orgs = await this.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .limit(2);
    return orgs.length === 1 ? orgs[0]!.id : null;
  }

  // ---- personas (PG) ----
  // The org's coaching personas. Auto-provisions the default Alex Hormozi persona on first
  // read so After-Sales always has at least one lens (interchangeable: add more rows later).
  async listPersonas(orgId: string): Promise<ActivatePersona[]> {
    let rows = await this.db
      .select({ id: schema.personas.id, name: schema.personas.name })
      .from(schema.personas)
      .where(tenantScope(orgId, schema.personas))
      .orderBy(schema.personas.createdAt);
    if (rows.length === 0) {
      await this.db
        .insert(schema.personas)
        .values({
          organizationId: orgId,
          name: DEFAULT_PERSONA_NAME,
          systemPrompt: DEFAULT_PERSONA_PROMPT,
        })
        .onConflictDoNothing();
      rows = await this.db
        .select({ id: schema.personas.id, name: schema.personas.name })
        .from(schema.personas)
        .where(tenantScope(orgId, schema.personas))
        .orderBy(schema.personas.createdAt);
    }
    return rows;
  }

  // Resolve a persona by name to its system prompt: exact -> substring -> first -> default.
  async resolvePersona(
    orgId: string,
    name?: string,
  ): Promise<{ name: string; prompt: string }> {
    const rows = await this.db
      .select()
      .from(schema.personas)
      .where(tenantScope(orgId, schema.personas))
      .orderBy(schema.personas.createdAt);
    const target = (name ?? '').trim().toLowerCase();
    const exact = rows.find((r) => r.name.toLowerCase() === target);
    const sub = exact ?? rows.find((r) => target && r.name.toLowerCase().includes(target));
    const match = sub ?? rows[0];
    if (match) return { name: match.name, prompt: match.systemPrompt };
    return { name: name || DEFAULT_PERSONA_NAME, prompt: DEFAULT_PERSONA_PROMPT };
  }

  // ---- meeting booker (DB-backed upcoming meetings) ----
  // An "upcoming" meeting = a calendar booking with no transcript yet (vs an after-sales call,
  // which has one). `aeName` holds the owner mailbox — the booker's account toggle axis.
  async listUpcomingMeetings(
    orgId: string,
    ownerEmail?: string,
  ): Promise<ActivateMeeting[]> {
    const rows = await this.db
      .select()
      .from(schema.meetings)
      .where(and(tenantScope(orgId, schema.meetings), isNull(schema.meetings.transcript)))
      .orderBy(asc(schema.meetings.meetingDate));
    const filtered = ownerEmail
      ? rows.filter((r) => (r.aeName ?? '') === ownerEmail)
      : rows;
    return filtered
      .map((r) => mapBookerMeeting(r))
      .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
  }

  // The distinct owner mailboxes across the org's upcoming meetings — the account toggle.
  async listMeetingOwners(orgId: string): Promise<ActivateMeetingAccount[]> {
    const rows = await this.db
      .select({ ae: schema.meetings.aeName })
      .from(schema.meetings)
      .where(and(tenantScope(orgId, schema.meetings), isNull(schema.meetings.transcript)));
    const emails = [...new Set(rows.map((r) => r.ae ?? '').filter(Boolean))].sort();
    return emails.map((email) => ({
      id: email,
      email,
      displayName: null,
      status: 'CONNECTED',
    }));
  }

  async getUpcomingMeeting(orgId: string, id: string): Promise<ActivateMeeting> {
    const row = await this.requireMeeting(orgId, id);
    return mapBookerMeeting(row);
  }

  // ---- after-sales meetings ----
  // Meetings that can appear in After-Sales: those with a stored transcript (analyzable).
  // Newest first, shaped for the UI.
  async listAnalyzableMeetings(
    orgId: string,
    opts?: { q?: string; date?: string },
  ): Promise<ActivateCallAnalysis[]> {
    // After-sales shows any call we can act on: one with a transcript (analyzable now) OR
    // any Read AI meeting (incl. email-harvested, transcript pending) so it's searchable
    // and the user can pull the transcript on demand.
    const rows = await this.db
      .select()
      .from(schema.meetings)
      .where(
        and(
          tenantScope(orgId, schema.meetings),
          or(
            isNotNull(schema.meetings.transcript),
            like(schema.meetings.matchMethod, 'read_ai%'),
          ),
        ),
      )
      .orderBy(desc(schema.meetings.meetingDate));
    let filtered = rows;
    // Search by name (company / contact / title) — substring, case-insensitive.
    const q = opts?.q?.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((r) =>
        [r.clientCompany, r.clientContact, r.clientEmail, r.title]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      );
    }
    // Search by date — meetings on that calendar day (meetingDate is an ISO string).
    const date = opts?.date?.trim();
    if (date) {
      filtered = filtered.filter((r) => (r.meetingDate ?? '').startsWith(date));
    }
    return filtered.map((r) => mapMeeting(r));
  }

  // Meeting ids that have a transcript but no analysis yet — the auto-analyze worklist
  // (run after a Read AI sync so a newly-arrived transcript gets scored automatically).
  async listMeetingIdsNeedingAnalysis(orgId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.meetings.id })
      .from(schema.meetings)
      .where(
        and(
          tenantScope(orgId, schema.meetings),
          isNotNull(schema.meetings.transcript),
          isNull(schema.meetings.analysis),
        ),
      );
    return rows.map((r) => r.id);
  }

  async requireMeeting(orgId: string, id: string): Promise<MeetingRow> {
    const rows = await this.db
      .select()
      .from(schema.meetings)
      .where(and(tenantScope(orgId, schema.meetings), eq(schema.meetings.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Meeting not found');
    return row;
  }

  // Persist a fresh analysis + persona + overall score onto the meeting, return the UI shape.
  async saveAnalysis(
    orgId: string,
    id: string,
    persona: string,
    analysis: Record<string, unknown>,
  ): Promise<ActivateCallAnalysis> {
    const score = overallPerformance(analysis);
    const rows = await this.db
      .update(schema.meetings)
      .set({ analysis, persona, score, updatedAt: new Date() })
      .where(and(tenantScope(orgId, schema.meetings), eq(schema.meetings.id, id)))
      .returning();
    const row = rows[0];
    if (!row) throw new NotFoundException('Meeting not found');
    return mapMeeting(row);
  }

  // ---- company context for research (best-effort) ----
  async companyContext(orgId: string, company: string): Promise<CompanyContext> {
    const empty: CompanyContext = {
      country: null,
      region: null,
      niche: null,
      productOrService: null,
      knownFacts: [],
    };
    if (!company.trim()) return empty;
    const prospects = await this.db
      .select()
      .from(schema.prospects)
      .where(
        and(
          tenantScope(orgId, schema.prospects),
          ilike(schema.prospects.companyName, `%${company.trim()}%`),
        ),
      )
      .limit(1);
    const prospect = prospects[0];
    if (!prospect) return empty;

    const campaigns = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, prospect.campaignId))
      .limit(1);
    const campaign = campaigns[0];
    let niche: string | null = null;
    if (campaign) {
      const niches = await this.db
        .select({ name: schema.niches.name })
        .from(schema.niches)
        .where(eq(schema.niches.id, campaign.nicheId))
        .limit(1);
      niche = niches[0]?.name ?? null;
    }
    const facts: string[] = [];
    if (prospect.city) facts.push(`Based in ${prospect.city}`);
    if (prospect.website) facts.push(`Website: ${prospect.website}`);
    if (campaign?.project) facts.push(`Targeted in campaign: ${campaign.project}`);
    return {
      country: prospect.country ?? null,
      region: campaign?.region ?? null,
      niche,
      productOrService: campaign?.project ?? null,
      knownFacts: facts,
    };
  }

  // ---- demo seed ----
  // Seed the Activate plane's demo data into the DB (idempotent on (org, sessionId)):
  //   - upcoming booker meetings (no transcript) spread across the current week, each owned by a
  //     mailbox (aeName) and carrying a Meet join link (docUrl) — these drive the Booker grid,
  //     the account toggle, the popup, and the Company Research targets;
  //   - analyzable after-sales calls (with transcripts) — these drive After-Sales Analysis.
  async seedDemoMeetings(orgId: string): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    // Booker meetings: assign each to a weekday of the CURRENT week so they always render.
    const monday = mondayOfThisWeek();
    for (const demo of DEMO_BOOKER_MEETINGS) {
      const inserted = await this.insertMeetingIfNew(orgId, demo.sessionId, {
        organizationId: orgId,
        sessionId: demo.sessionId,
        title: demo.title,
        clientCompany: demo.clientCompany,
        aeName: demo.ownerEmail, // owner mailbox = the booker account axis
        clientContact: demo.clientContact,
        clientEmail: demo.clientEmail,
        meetingDate: isoAt(monday, demo.dayOffset, demo.hour, demo.minute),
        persona: null,
        analysis: null,
        transcript: null, // null transcript = upcoming (not after-sales)
        docUrl: demo.joinUrl, // join link surfaced as joinUrl in the popup
        score: null,
        campaignId: null,
        leadId: null,
        matchMethod: null,
      });
      inserted ? created++ : skipped++;
    }

    // After-sales calls (with transcripts).
    for (const demo of DEMO_MEETINGS) {
      const inserted = await this.insertMeetingIfNew(orgId, demo.sessionId, {
        organizationId: orgId,
        sessionId: demo.sessionId,
        title: demo.title,
        clientCompany: demo.clientCompany,
        aeName: demo.aeName,
        clientContact: demo.clientContact,
        clientEmail: demo.clientEmail,
        meetingDate: demo.meetingDate,
        persona: null,
        analysis: null,
        transcript: demo.transcript,
        docUrl: null,
        score: null,
        campaignId: null,
        leadId: null,
        matchMethod: null,
      });
      inserted ? created++ : skipped++;
    }
    return { created, skipped };
  }

  // Upsert Read AI meetings into the meetings store. Both ingest paths flow through here
  // and converge on ONE row per meeting via a deterministic (title, Berlin-date) session
  // key, so the Gmail-harvest path (summary, no transcript) and the MCP path (transcript)
  // merge instead of duplicating. Every field is COALESCE-merged (incoming wins only when
  // non-null), and OUR analysis/persona/score is never touched. Idempotent.
  async importReadAiMeetings(
    orgId: string,
    items: ReadAiImportItem[],
  ): Promise<{ count: number }> {
    let count = 0;
    for (const it of items) {
      const key = readAiSessionKey(it.title, it.meetingDate);
      if (!key) continue; // need at least a title to form a stable key
      const matchMethod = it.transcript ? 'read_ai' : 'read_ai_email';
      await this.db
        .insert(schema.meetings)
        .values({
          organizationId: orgId,
          sessionId: key,
          readAiId: it.readAiId ?? null,
          title: it.title ?? null,
          clientCompany: it.company ?? null,
          aeName: it.owner ?? null,
          clientContact: it.contact ?? null,
          clientEmail: it.email ?? null,
          meetingDate: it.meetingDate ?? null,
          transcript: it.transcript ?? null,
          summary: it.summary ?? null,
          docUrl: it.docUrl ?? null,
          matchMethod,
        })
        .onConflictDoUpdate({
          target: [schema.meetings.organizationId, schema.meetings.sessionId],
          set: {
            readAiId: sql`coalesce(excluded.read_ai_id, ${schema.meetings.readAiId})`,
            title: sql`coalesce(excluded.title, ${schema.meetings.title})`,
            clientCompany: sql`coalesce(excluded.client_company, ${schema.meetings.clientCompany})`,
            aeName: sql`coalesce(excluded.ae_name, ${schema.meetings.aeName})`,
            clientContact: sql`coalesce(excluded.client_contact, ${schema.meetings.clientContact})`,
            clientEmail: sql`coalesce(excluded.client_email, ${schema.meetings.clientEmail})`,
            meetingDate: sql`coalesce(excluded.meeting_date, ${schema.meetings.meetingDate})`,
            transcript: sql`coalesce(excluded.transcript, ${schema.meetings.transcript})`,
            summary: sql`coalesce(excluded.summary, ${schema.meetings.summary})`,
            docUrl: sql`coalesce(excluded.doc_url, ${schema.meetings.docUrl})`,
            // Prefer 'read_ai' (transcript present) over 'read_ai_email' once a transcript lands.
            matchMethod: sql`case when excluded.transcript is not null then 'read_ai' else ${schema.meetings.matchMethod} end`,
            updatedAt: new Date(),
            // analysis / persona / score deliberately omitted — our work survives re-sync.
          },
        });
      count++;
    }
    return { count };
  }

  // Insert a meeting only if (org, sessionId) doesn't already exist. Returns true if inserted.
  private async insertMeetingIfNew(
    orgId: string,
    sessionId: string,
    values: typeof schema.meetings.$inferInsert,
  ): Promise<boolean> {
    const existing = await this.db
      .select({ id: schema.meetings.id })
      .from(schema.meetings)
      .where(
        and(
          tenantScope(orgId, schema.meetings),
          eq(schema.meetings.sessionId, sessionId),
        ),
      )
      .limit(1);
    if (existing[0]) return false;
    await this.db.insert(schema.meetings).values(values);
    return true;
  }

  // Record (or update) the meetings row for a meeting booked via the Engage handoff,
  // keyed on the Google event id (organization_id + session_id is UNIQUE, so a re-book of
  // the same event updates in place). transcript:null marks it as an upcoming Booker
  // meeting, not an after-sales call. matchMethod 'engage_booking' tags its origin.
  async createBookedMeeting(
    orgId: string,
    values: {
      eventId: string;
      title: string;
      clientCompany: string;
      clientContact: string | null;
      clientEmail: string;
      ownerEmail: string;
      meetingDateIso: string;
      joinUrl: string | null;
    },
  ): Promise<void> {
    await this.db
      .insert(schema.meetings)
      .values({
        organizationId: orgId,
        sessionId: values.eventId,
        title: values.title,
        clientCompany: values.clientCompany,
        aeName: values.ownerEmail,
        clientContact: values.clientContact,
        clientEmail: values.clientEmail,
        meetingDate: values.meetingDateIso,
        transcript: null,
        docUrl: values.joinUrl,
        campaignId: null,
        leadId: null,
        matchMethod: 'engage_booking',
      })
      .onConflictDoUpdate({
        target: [schema.meetings.organizationId, schema.meetings.sessionId],
        set: {
          title: values.title,
          clientCompany: values.clientCompany,
          aeName: values.ownerEmail,
          clientContact: values.clientContact,
          clientEmail: values.clientEmail,
          meetingDate: values.meetingDateIso,
          docUrl: values.joinUrl,
          updatedAt: new Date(),
        },
      });
  }
}

// Deterministic session key shared by both Read AI ingest paths (Gmail-harvest summary +
// MCP transcript) so they converge on ONE meeting row. Keyed on (Berlin calendar date,
// title-slug) — the email subject's date is Berlin-local, and the MCP ISO start is
// normalized to Berlin here, so both produce the same key. null when there's no title.
function readAiSessionKey(
  title?: string | null,
  meetingDateIso?: string | null,
): string | null {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!slug) return null;
  let ymd = 'nodate';
  if (meetingDateIso) {
    const d = new Date(meetingDateIso);
    if (!Number.isNaN(d.getTime())) {
      // en-CA → YYYY-MM-DD; Europe/Berlin to match the report email's local date.
      ymd = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    }
  }
  return `readai:${ymd}:${slug}`;
}

// ---- booker meeting mapping + date helpers ----
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function mapBookerMeeting(r: MeetingRow): ActivateMeeting {
  const startIso = r.meetingDate ? new Date(r.meetingDate).toISOString() : null;
  const start = startIso ? new Date(startIso) : null;
  const endIso = start ? new Date(start.getTime() + 30 * 60000).toISOString() : null;
  return {
    id: r.id,
    day: start ? `${WEEKDAYS[start.getDay()]} ${start.getDate()}` : '',
    time: start
      ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
      : '',
    company: r.clientCompany ?? 'Meeting',
    contact: r.clientContact ?? r.clientEmail ?? 'Guest',
    title: r.title ?? '(no title)',
    startsAt: startIso,
    endsAt: endIso,
    durationMinutes: 30,
    location: null,
    description: null,
    joinUrl: r.docUrl ?? null,
    htmlLink: r.docUrl ?? null,
    attendees: r.clientContact || r.clientEmail
      ? [{ name: r.clientContact, email: r.clientEmail, responseStatus: null }]
      : [],
    organizer: r.aeName ?? null,
  };
}

// Monday 00:00 (local) of the current week.
function mondayOfThisWeek(): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

function isoAt(monday: Date, dayOffset: number, hour: number, minute: number): string {
  const d = new Date(monday);
  d.setDate(monday.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

// ---- mapping: meeting row -> UI CallAnalysis ----
const PERF_KEYS: Array<[string, string]> = [
  ['overall', 'Overall'],
  ['understanding_client_needs', 'Understanding Needs'],
  ['communication', 'Communication'],
  ['technical_explanation', 'Technical Explanation'],
  ['aggressiveness', 'Aggressiveness'],
];
const TECH_KEYS: Array<[string, string]> = [
  ['rapport_building', 'Rapport Building'],
  ['discovery_quality', 'Discovery Quality'],
  ['pain_discovery', 'Pain Discovery'],
  ['value_communication', 'Value Communication'],
];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function scoreOf(section: unknown, key: string): number | null {
  const sub = ((section as Record<string, unknown>)?.[key] ?? {}) as Record<string, unknown>;
  return num(sub.score);
}

function overallPerformance(analysis: Record<string, unknown>): number | null {
  return scoreOf(analysis.performance_score, 'overall');
}

function band(score: number | null, hi: number, lo: number): 'High' | 'Medium' | 'Low' {
  if (score === null) return 'Medium';
  if (score >= hi) return 'High';
  if (score < lo) return 'Low';
  return 'Medium';
}

function sentimentOf(score: number | null): 'Positive' | 'Neutral' | 'Negative' {
  if (score === null) return 'Neutral';
  if (score >= 60) return 'Positive';
  if (score < 35) return 'Negative';
  return 'Neutral';
}

// Client / AE word-share from the transcript, AE = the analysis ae_name or the first speaker.
function talkRatio(transcript: string | null, aeName: string): string {
  if (!transcript) return '—';
  const turnRe = /^(?:\[\d{2}:\d{2}\]\s*)?([A-Za-z][^:]{0,60}):\s/;
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const line of transcript.split('\n')) {
    const m = turnRe.exec(line);
    if (!m) continue;
    const name = m[1]!.trim();
    const words = line.slice(m[0].length).split(/\s+/).filter(Boolean).length;
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + words);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return '—';
  const ae = aeName && counts.has(aeName) ? aeName : order[0] ?? '';
  const aeWords = counts.get(ae) ?? 0;
  const aePct = Math.round((aeWords / total) * 100);
  return `${100 - aePct} / ${aePct}`;
}

function durationFrom(transcript: string | null): string {
  if (!transcript) return '—';
  const words = transcript.split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 140))} min`;
}

function flattenStrengths(items: unknown): string[] {
  return (Array.isArray(items) ? items : []).map((s) => {
    const o = s as Record<string, unknown>;
    const moment = String(o.moment ?? '').trim();
    const why = String(o.why_effective ?? '').trim();
    return [moment, why].filter(Boolean).join(' — ') || 'Strength noted';
  });
}

function flattenWeaknesses(items: unknown): string[] {
  return (Array.isArray(items) ? items : []).map((w) => {
    const o = w as Record<string, unknown>;
    const area = String(o.area ?? '').trim();
    const fix = String(o.suggestion ?? '').trim();
    return [area, fix].filter(Boolean).join(' — ') || 'Area to improve';
  });
}

// Action items the salesperson can implement next time: the persona's concrete fixes.
function actionItemsFrom(analysis: Record<string, unknown>): Array<{ id: string; label: string; done: boolean }> {
  const out: Array<{ id: string; label: string; done: boolean }> = [];
  const weaknesses = Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [];
  for (const [i, w] of weaknesses.entries()) {
    const fix = String((w as Record<string, unknown>).suggestion ?? '').trim();
    if (fix) out.push({ id: `w${i}`, label: fix, done: false });
  }
  const tech = (analysis.sales_technique_analysis ?? {}) as Record<string, unknown>;
  for (const [key] of TECH_KEYS) {
    const rec = String((tech[key] as Record<string, unknown>)?.improvement_recommendation ?? '').trim();
    if (rec) out.push({ id: `t_${key}`, label: rec, done: false });
  }
  return out.slice(0, 6);
}

function mapMeeting(r: MeetingRow): ActivateCallAnalysis {
  const analysis = (r.analysis ?? null) as Record<string, unknown> | null;
  const analyzed = analysis !== null;
  const date = formatDate(r.meetingDate ?? (r.createdAt ? new Date(r.createdAt).toISOString() : null));
  const aeName = String(analysis?.ae_name ?? r.aeName ?? '');
  const clientScore = scoreOf(analysis?.client_analysis, 'overall');
  const buyingIntent = scoreOf(analysis?.client_analysis, 'buying_intent');

  return {
    id: r.id,
    company: r.clientCompany ?? String(analysis?.client_company ?? 'Unknown'),
    contact: r.clientContact ?? String(analysis?.client_contact ?? ''),
    date,
    duration: durationFrom(r.transcript),
    sentiment: analyzed ? sentimentOf(clientScore) : 'Neutral',
    closeProbability: analyzed ? band(buyingIntent, 60, 35) : 'Medium',
    talkRatio: talkRatio(r.transcript, aeName),
    summary: analyzed
      ? String(analysis?.overall_summary ?? '')
      : r.summary
        ? `Read AI summary: ${r.summary}`
        : r.transcript
          ? 'Not analyzed yet — run the sales coach to score this call.'
          : 'Transcript pending — pull it from Read AI, then run the sales coach.',
    actionItems: analyzed ? actionItemsFrom(analysis!) : [],
    persona: r.persona ?? null,
    hasTranscript: Boolean(r.transcript),
    analyzed,
    performance: analyzed
      ? PERF_KEYS.map(([key, label]) => ({ label, score: scoreOf(analysis?.performance_score, key) }))
      : [],
    technique: analyzed
      ? TECH_KEYS.map(([key, label]) => {
          const t = (analysis?.sales_technique_analysis as Record<string, unknown>)?.[key] as
            | Record<string, unknown>
            | undefined;
          return {
            label,
            score: num(t?.score),
            recommendation: String(t?.improvement_recommendation ?? ''),
          };
        })
      : [],
    strengths: analyzed ? flattenStrengths(analysis?.strengths) : [],
    weaknesses: analyzed ? flattenWeaknesses(analysis?.weaknesses) : [],
  };
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---- upcoming booker meetings (migrated from the old client constant.ts CALENDAR_MEETINGS) ----
// dayOffset: 0=Mon … 4=Fri of the current week. ownerEmail = the account-toggle axis.
const DEMO_BOOKER_MEETINGS: Array<{
  sessionId: string;
  dayOffset: number;
  hour: number;
  minute: number;
  title: string;
  clientCompany: string;
  clientContact: string;
  clientEmail: string;
  ownerEmail: string;
  joinUrl: string;
}> = [
  {
    sessionId: 'demo-booker-dresden',
    dayOffset: 1,
    hour: 11,
    minute: 0,
    title: 'Intro call',
    clientCompany: 'Dresden Building Co-op',
    clientContact: 'Mr. Lorenz',
    clientEmail: 'lorenz@dresden-build.example',
    ownerEmail: 'info@evertrust-germany.de',
    joinUrl: 'https://meet.google.com/lookup/demo-dresden',
  },
  {
    sessionId: 'demo-booker-lippe',
    dayOffset: 2,
    hour: 9,
    minute: 30,
    title: 'Needs assessment',
    clientCompany: 'Lippe District Build',
    clientContact: 'Ms. Otto',
    clientEmail: 'otto@lippe-build.example',
    ownerEmail: 'info@evertrust-germany.de',
    joinUrl: 'https://meet.google.com/lookup/demo-lippe',
  },
  {
    sessionId: 'demo-booker-gewoba',
    dayOffset: 3,
    hour: 14,
    minute: 0,
    title: '180 units',
    clientCompany: 'GeWoBa Bremen',
    clientContact: 'Mr. Albers',
    clientEmail: 'albers@gewoba-bremen.example',
    ownerEmail: 'info@evertrust-germany.de',
    joinUrl: 'https://meet.google.com/lookup/demo-gewoba',
  },
  {
    sessionId: 'demo-booker-bayer',
    dayOffset: 3,
    hour: 16,
    minute: 30,
    title: 'Resale discussion',
    clientCompany: 'Bayer Electric KG',
    clientContact: 'Mr. Bayer',
    clientEmail: 'bayer@bayer-electric.example',
    ownerEmail: 'admin@evertrust-germany.de',
    joinUrl: 'https://meet.google.com/lookup/demo-bayer',
  },
  {
    sessionId: 'demo-booker-wohnquartier',
    dayOffset: 4,
    hour: 10,
    minute: 30,
    title: '320 units',
    clientCompany: 'WohnQuartier NRW',
    clientContact: 'Mr. Cetin',
    clientEmail: 'cetin@wohnquartier-nrw.example',
    ownerEmail: 'admin@evertrust-germany.de',
    joinUrl: 'https://meet.google.com/lookup/demo-wohnquartier',
  },
  {
    sessionId: 'demo-booker-augsburg-pilot',
    dayOffset: 4,
    hour: 15,
    minute: 15,
    title: 'Pilot',
    clientCompany: 'Augsburg Utilities',
    clientContact: 'Mr. Vogt',
    clientEmail: 'vogt@augsburg-utilities.example',
    ownerEmail: 'admin@evertrust-germany.de',
    joinUrl: 'https://meet.google.com/lookup/demo-augsburg',
  },
];

// ---- demo meetings (transcripts only; the user analyzes them via the persona) ----
const DEMO_MEETINGS: Array<{
  sessionId: string;
  title: string;
  clientCompany: string;
  aeName: string;
  clientContact: string;
  clientEmail: string;
  meetingDate: string;
  transcript: string;
}> = [
  {
    sessionId: 'demo-activate-augsburg',
    title: 'Augsburg Utilities · Pilot call',
    clientCompany: 'Augsburg Utilities',
    aeName: 'Robin',
    clientContact: 'Mr. Vogt',
    clientEmail: 'vogt@augsburg-utilities.example',
    meetingDate: '2026-06-19',
    transcript: [
      '[00:00] Robin: Hi Mr. Vogt, thanks for taking the time today. How are things at Augsburg Utilities?',
      '[00:20] Vogt: Good thanks. We are exploring tenant power for a few of our residential buildings.',
      '[00:35] Robin: What is driving that internally right now, budget pressure or decarbonisation targets?',
      '[01:00] Vogt: Mostly the municipal decarbonisation plan. We manage about 9500 units in total.',
      '[01:20] Robin: For a controlled start we usually propose a 40 unit pilot with tiered pricing from 100 units.',
      '[01:45] Vogt: That could work for us. What about inverter certification and the delivery time on the kits?',
      '[02:10] Robin: Full EU certification, delivery within six weeks. I will prepare a tiered quote for 40 units.',
      '[02:30] Vogt: Perfect, please send it over. A Q3 budget release is realistic for a pilot like this.',
    ].join('\n'),
  },
  {
    sessionId: 'demo-activate-northern',
    title: 'Northern Homebuild Co-op · Framework',
    clientCompany: 'Northern Homebuild Co-op',
    aeName: 'Robin',
    clientContact: 'Ms. Petersen',
    clientEmail: 'petersen@northern-homebuild.example',
    meetingDate: '2026-06-17',
    transcript: [
      '[00:00] Robin: Hi Ms. Petersen, good to connect. I understand you are weighing a larger framework order.',
      '[00:18] Petersen: Yes, we are looking at roughly 120 units across several buildings this year.',
      '[00:40] Robin: That is a great fit. What matters most to you, delivery window, warranty, or upfront price?',
      '[01:05] Petersen: Delivery window and warranty handling, mostly. Price we can work with if those are solid.',
      '[01:30] Robin: We deliver in batches with a ten year warranty and on-site replacement. First batch in four weeks.',
      '[01:55] Petersen: That sounds strong. Can you send the final framework contract for review?',
      '[02:15] Robin: Absolutely, I will send the framework contract and confirm the first batch delivery timing.',
      '[02:35] Petersen: Great, we are keen to get the first installation going soon.',
    ].join('\n'),
  },
  {
    sessionId: 'demo-activate-proimmo',
    title: 'ProImmo Mgmt · Pricing call',
    clientCompany: 'ProImmo Mgmt',
    aeName: 'Robin',
    clientContact: 'Ms. Wagner',
    clientEmail: 'wagner@proimmo.example',
    meetingDate: '2026-06-15',
    transcript: [
      '[00:00] Robin: Hi Ms. Wagner, thanks for the time. You mentioned you wanted pricing on the balcony kits.',
      '[00:18] Wagner: Yes, mainly pricing for now. We are not ready to commit to anything yet.',
      '[00:38] Robin: Understood. Are you weighing the kits with storage or without, so I quote the right option?',
      '[01:00] Wagner: Not sure yet. The storage option is really the main decision point for us.',
      '[01:25] Robin: Got it. I can send a side-by-side with and without storage so the cost difference is clear.',
      '[01:50] Wagner: That would help. We will review internally before any next step.',
      '[02:10] Robin: No problem, I will send the pricing comparison and follow up after a few working days.',
      '[02:30] Wagner: Sounds good, thank you.',
    ].join('\n'),
  },
];
