// Pure helpers that turn one EVERTRUST - SALES AGENT execution's runData into a
// meeting row. No DB/network here so it's unit-testable in isolation.

export interface RunItem {
  json?: Record<string, unknown>;
}
export interface NodeRun {
  data?: { main?: Array<RunItem[] | null> };
}
export type RunData = Record<string, NodeRun[] | undefined>;

// Calls from your own staff don't count as the prospect.
const INTERNAL_DOMAIN = '@evertrust-germany.de';

function firstJson(
  rd: RunData,
  name: string,
): Record<string, unknown> | undefined {
  return rd[name]?.[0]?.data?.main?.[0]?.[0]?.json;
}

function get(o: unknown, key: string): unknown {
  return o && typeof o === 'object'
    ? (o as Record<string, unknown>)[key]
    : undefined;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

interface Participant {
  name?: string;
  email?: string;
}

// The prospect = the first participant who is neither the meeting owner (your AE)
// nor on the internal domain. Read.ai includes everyone's email in `participants`.
export function pickProspectEmail(
  body: Record<string, unknown> | undefined,
): string | null {
  if (!body) return null;
  const owner = String(get(body.owner, 'email') ?? '').toLowerCase();
  const parts = Array.isArray(body.participants)
    ? (body.participants as Participant[])
    : [];
  for (const p of parts) {
    const e = String(p?.email ?? '')
      .toLowerCase()
      .trim();
    if (!e || e === owner || e.endsWith(INTERNAL_DOMAIN)) continue;
    return e;
  }
  return null;
}

// Rebuild the plaintext transcript from Read.ai speaker_blocks (mirrors the
// workflow's "Adapt Transcript"): `[mm:ss] Name: words`, times relative to start.
export function buildTranscript(
  body: Record<string, unknown> | undefined,
): string | null {
  const t = get(body, 'transcript');
  const blocks = get(t, 'speaker_blocks');
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const start =
    typeof get(blocks[0], 'start_time') === 'number'
      ? (get(blocks[0], 'start_time') as number)
      : 0;
  const lines: string[] = [];
  for (const b of blocks) {
    const name = str(get(get(b, 'speaker'), 'name')) ?? 'Unknown';
    const words = str(get(b, 'words')) ?? '';
    const st = get(b, 'start_time');
    const ms = typeof st === 'number' ? st : start;
    const sec = Math.max(0, Math.floor((ms - start) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    lines.push(`[${mm}:${ss}] ${name}: ${words}`);
  }
  return lines.join('\n');
}

export interface ExtractedMeeting {
  sessionId: string | null;
  title: string | null;
  clientCompany: string | null;
  aeName: string | null;
  clientContact: string | null;
  clientEmail: string | null;
  meetingDate: string | null;
  docUrl: string | null;
  score: number | null;
  analysis: Record<string, unknown> | null;
  transcript: string | null;
}

export function extractMeeting(rd: RunData): ExtractedMeeting | null {
  const body = get(firstJson(rd, 'Read.ai Webhook'), 'body') as
    | Record<string, unknown>
    | undefined;
  const analysis =
    (get(firstJson(rd, 'Sales Coach Agent'), 'output') as
      | Record<string, unknown>
      | undefined) ?? null;
  const doc = firstJson(rd, 'Create Meeting Doc');

  if (!analysis && !body) return null;

  // Meeting date from Read.ai start_time (epoch ms) → yyyy-MM-dd.
  let meetingDate: string | null = null;
  const st = body?.start_time;
  if (typeof st === 'number' && Number.isFinite(st)) {
    meetingDate = new Date(st).toISOString().slice(0, 10);
  }

  const overall = get(get(analysis, 'performance_score'), 'overall');

  return {
    sessionId: str(body?.session_id),
    title: str(body?.title),
    clientCompany: str(get(analysis, 'client_company')),
    aeName: str(get(analysis, 'ae_name')),
    clientContact: str(get(analysis, 'client_contact')),
    clientEmail: pickProspectEmail(body),
    meetingDate,
    docUrl: str(get(doc, 'webViewLink')),
    score: intOrNull(get(overall, 'score')),
    analysis,
    transcript: buildTranscript(body),
  };
}
