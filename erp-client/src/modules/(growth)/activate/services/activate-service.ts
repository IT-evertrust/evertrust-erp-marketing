import { API_URL } from '@/lib/env';

import type {
  CalendarMeeting,
  CallAnalysis,
  ClientResearch,
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

// ---- Client Research (persisted deep dossier: MBTI + personality + deal economics) ----
export function listClientResearch(): Promise<ClientResearch[]> {
  return getJson<ClientResearch[]>('/growth/activate/research');
}

// Returns the persisted research row for a company, or null if none exists yet.
export function getClientResearch(company: string): Promise<ClientResearch | null> {
  if (!company) return Promise.resolve(null);
  return getJson<ClientResearch | null>(
    `/growth/activate/research/${encodeURIComponent(company)}`,
  );
}

export function generateClientResearch(
  company: string,
  clientEmail?: string,
): Promise<ClientResearch> {
  return postJson<ClientResearch>('/growth/activate/research/generate', {
    company,
    clientEmail,
  });
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

// Pull recent Read AI meetings + FULL transcripts via the Read AI API, then auto-analyze
// any that gained a transcript. status="disabled" when no Read AI API key is configured.
export function syncReadAiMeetings(): Promise<{
  imported: number;
  analyzed: number;
  status: string;
  reason?: string;
}> {
  return postJson('/growth/activate/read-ai/sync');
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
