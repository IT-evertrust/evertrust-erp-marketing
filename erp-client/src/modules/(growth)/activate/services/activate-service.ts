import { API_URL } from '@/lib/env';

import type {
  CalendarMeeting,
  CallAnalysis,
  MeetingAccount,
  Persona,
  ResearchDossier,
} from '../types';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let message = `POST ${path} -> ${res.status}`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json?.message) {
        message = Array.isArray(json.message) ? json.message.join(', ') : json.message;
      }
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// ---- Meeting Booker (live Google Calendar) ----
export function getMeetingAccounts(): Promise<MeetingAccount[]> {
  return getJson<MeetingAccount[]>('/growth/activate/meeting-accounts');
}

export function getCalendarMeetings(accountId: string): Promise<CalendarMeeting[]> {
  if (!accountId) return Promise.resolve([]);
  return getJson<CalendarMeeting[]>(
    `/growth/activate/meetings?accountId=${encodeURIComponent(accountId)}`,
  );
}

export function requestToJoinMeeting(
  accountId: string,
  eventId: string,
): Promise<{ status: 'ok' | 'no_link'; joinUrl: string | null; htmlLink: string | null }> {
  return postJson(
    `/growth/activate/meetings/${encodeURIComponent(eventId)}/join?accountId=${encodeURIComponent(accountId)}`,
  );
}

// Edit a meeting in place on its account's calendar.
export async function updateMeeting(
  accountId: string,
  eventId: string,
  patch: {
    title?: string;
    description?: string | null;
    location?: string | null;
    start?: string;
    end?: string;
  },
): Promise<CalendarMeeting> {
  const res = await fetch(
    `${API_URL}/growth/activate/meetings/${encodeURIComponent(eventId)}?accountId=${encodeURIComponent(accountId)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) throw new Error(await errorMessage(res, 'PATCH meeting'));
  return (await res.json()) as CalendarMeeting;
}

// Move a meeting to another connected account's calendar.
export function moveMeeting(
  eventId: string,
  fromAccountId: string,
  toAccountId: string,
): Promise<CalendarMeeting> {
  return postJson<CalendarMeeting>(
    `/growth/activate/meetings/${encodeURIComponent(eventId)}/move?from=${encodeURIComponent(fromAccountId)}&to=${encodeURIComponent(toAccountId)}`,
  );
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as { message?: string | string[] };
    if (json?.message) {
      return Array.isArray(json.message) ? json.message.join(', ') : json.message;
    }
  } catch {
    /* keep fallback */
  }
  return `${fallback} -> ${res.status}`;
}

// ---- Company Research ----
export function getResearchDossiers(accountId: string): Promise<ResearchDossier[]> {
  if (!accountId) return Promise.resolve([]);
  return getJson<ResearchDossier[]>(
    `/growth/activate/dossiers?accountId=${encodeURIComponent(accountId)}`,
  );
}

export function generateDossier(
  accountId: string,
  eventId: string,
): Promise<ResearchDossier> {
  return postJson<ResearchDossier>(
    `/growth/activate/dossiers/${encodeURIComponent(eventId)}/generate?accountId=${encodeURIComponent(accountId)}`,
  );
}

// ---- Client Research (internal-data dossier + MBTI, persisted per company) ----
// The persisted client_research row as returned by the server.
export type ClientResearch = {
  company: string;
  clientEmail: string | null;
  profile: Array<{ label: string; value: string }> | null;
  signals: string[] | null;
  talkingPoints: string[] | null;
  interactionContext: string | null;
  history: Array<{ date?: string | null; kind: string; summary: string }> | null;
  mbti: string | null;
  mbtiConfidence: number | null;
  mbtiReasoning: string | null;
  personality: ResearchDossier['personality'];
  status: string;
  stage?: string | null;
  dealValue?: number | null;
  dealCurrency?: string | null;
  dealBasis?: string | null;
};

export function getClientResearch(): Promise<ClientResearch[]> {
  return getJson<ClientResearch[]>('/growth/activate/research');
}

export function generateClientResearch(company: string): Promise<ClientResearch> {
  return postJson<ClientResearch>('/growth/activate/research/generate', {
    company,
  });
}

// Merge a meeting + (optional) persisted research into the dossier the UI renders.
// Without research yet, the dossier shows as "Being generated".
export function mapDossier(
  meeting: { company: string; contact: string; meetingTime: string },
  research?: ClientResearch | null,
): ResearchDossier {
  return {
    id: meeting.company,
    company: meeting.company,
    contact: meeting.contact,
    meetingTime: meeting.meetingTime,
    status: research ? 'Dossier ready' : 'Being generated',
    profile: research?.profile ?? [],
    signals: research?.signals ?? [],
    talkingPoints: research?.talkingPoints ?? [],
    interactionContext: research?.interactionContext ?? undefined,
    history: research?.history ?? undefined,
    mbti: research?.mbti ?? undefined,
    mbtiConfidence: research?.mbtiConfidence ?? undefined,
    mbtiReasoning: research?.mbtiReasoning ?? undefined,
    personality: research?.personality ?? undefined,
    stage: research?.stage ?? undefined,
    dealValue: research?.dealValue ?? undefined,
    dealCurrency: research?.dealCurrency ?? undefined,
    dealBasis: research?.dealBasis ?? undefined,
  };
}

// ---- After-Sales Analysis ----
export function getPersonas(): Promise<Persona[]> {
  return getJson<Persona[]>('/growth/activate/personas');
}

// Analyzable calls, optionally searched by name (q) + calendar day (date = YYYY-MM-DD).
export function getCallAnalyses(
  q?: string,
  date?: string,
): Promise<CallAnalysis[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (date) params.set('date', date);
  const qs = params.toString();
  return getJson<CallAnalysis[]>(
    `/growth/activate/analyses${qs ? `?${qs}` : ''}`,
  );
}

// Import Read AI meetings (transcripts) into the after-sales store.
export function importReadAiMeetings(
  meetings: Array<Record<string, unknown>>,
): Promise<{ count: number }> {
  return postJson('/growth/activate/read-ai/import', { meetings });
}

// Autonomous harvest: pull the meeting list + summaries from Read AI's report emails (Gmail).
export function harvestReadAiMeetings(): Promise<{
  scanned: number;
  imported: number;
}> {
  return postJson('/growth/activate/read-ai/harvest');
}

export function analyzeMeeting(
  meetingId: string,
  persona?: string,
): Promise<CallAnalysis> {
  return postJson<CallAnalysis>(
    `/growth/activate/analyses/${encodeURIComponent(meetingId)}/analyze`,
    persona ? { persona } : {},
  );
}

export function seedActivateDemo(): Promise<{ created: number; skipped: number }> {
  return postJson('/growth/activate/demo-seed');
}
