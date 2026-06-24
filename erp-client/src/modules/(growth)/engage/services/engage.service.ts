import { API_URL } from '@/lib/env';

import type { CampaignReply, EngageCampaign, ReplyCategory } from '../types';

// ---- backend shapes (erp-server /engage campaign-centric reply pipeline) ----
interface BackendCampaign {
  aimId: string;
  name: string;
  niche: string;
  region: string;
  sender: string;
  status: string;
  leadCount: number;
  mailboxAccountId: string | null;
  mailboxEmail: string | null;
  personaId: string | null;
}

interface BackendThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  header: string;
  subject: string;
  body: string;
}

// The persisted, classified reply as returned by GET /engage/campaigns/:aimId/replies.
interface BackendReply {
  id: string;
  campaignId: string;
  company: string;
  contact: string;
  category: string; // already mapped to the UI vocabulary
  rawCategory: string;
  confidence: number;
  reasoning: string;
  recommendedAction: string | null;
  inboundPreview: string;
  inboundBody: string;
  draftSubject: string;
  draftBody: string;
  draftSource: string | null;
  citations: string[];
  followUpWindow: string | null;
  handled: boolean;
  thread: BackendThreadMessage[];
  time: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function mutate<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${method} ${path} -> ${res.status}`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json?.message) {
        message = Array.isArray(json.message)
          ? json.message.join(', ')
          : json.message;
      }
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// Classification is persisted by a separate (slow) campaign scan; page-load just
// reads it. Kept as a resolved no-op so the hook's sync→campaigns flow is unchanged.
export async function syncEngageInbox(): Promise<{
  accounts: number;
  scanned: number;
  matched: number;
  ingested: number;
}> {
  return { accounts: 0, scanned: 0, matched: 0, ingested: 0 };
}

// Campaigns = Reach AIMs (with lead count + the mailbox they send from).
export async function getEngageCampaigns(): Promise<EngageCampaign[]> {
  const data = await getJson<BackendCampaign[]>('/engage/campaigns');
  return data.map(mapCampaign);
}

// The reply-sorter queue for a campaign: the persisted, reply_glock-classified
// replies (category + AI draft + thread), read instantly from the server.
export async function getCampaignReplies(
  campaignId: string,
): Promise<CampaignReply[]> {
  if (!campaignId) return [];
  const data = await getJson<BackendReply[]>(
    `/engage/campaigns/${campaignId}/replies`,
  );
  return data.map(mapReply);
}

// Persist an edited draft.
export async function saveReplyDraft(
  replyId: string,
  subject: string,
  body: string,
): Promise<void> {
  await mutate('PATCH', `/engage/campaign-replies/${replyId}/draft`, {
    subject,
    body,
  });
}

// Send the (edited) draft to the lead, threaded onto the existing conversation.
export async function sendReply(
  replyId: string,
  subject: string,
  body: string,
): Promise<void> {
  await mutate('POST', `/engage/campaign-replies/${replyId}/send`, {
    subject,
    body,
  });
}

// ---- F4 persona + F3 training/redraft ----
export interface EngagePersona {
  id: string;
  name: string;
}
export interface EngageTrainingNote {
  id: string;
  note: string;
  source: string;
  active: boolean;
  createdAt: string;
}

// The org's drafting personas (shared with Activate coaching).
export async function getEngagePersonas(): Promise<EngagePersona[]> {
  return getJson<EngagePersona[]>('/engage/personas');
}

// Set (or clear, personaId=null) the campaign's drafting persona.
export async function setCampaignPersona(
  aimId: string,
  personaId: string | null,
): Promise<void> {
  await mutate('PATCH', `/engage/campaigns/${aimId}/persona`, { personaId });
}

// The campaign's "teach the AI" notes.
export async function getCampaignTraining(
  aimId: string,
): Promise<EngageTrainingNote[]> {
  if (!aimId) return [];
  return getJson<EngageTrainingNote[]>(`/engage/campaigns/${aimId}/training`);
}

// Add a "teach the AI" note (applied to all future drafts for the campaign).
export async function addCampaignTraining(
  aimId: string,
  note: string,
): Promise<void> {
  await mutate('POST', `/engage/campaigns/${aimId}/training`, { note });
}

export async function removeCampaignTraining(id: string): Promise<void> {
  await mutate('DELETE', `/engage/campaign-training/${id}`);
}

// Interactively revise a reply's draft ("Write & Fix"). Returns the new draft.
export async function redraftReply(
  replyId: string,
  instruction: string,
): Promise<{ draftSubject: string; draftBody: string }> {
  return mutate<{ draftSubject: string; draftBody: string }>(
    'POST',
    `/engage/campaign-replies/${replyId}/redraft`,
    { instruction },
  );
}

// ---- mappers: backend shape -> the UI's local view types (UI is untouched) ----
function mapCampaign(c: BackendCampaign): EngageCampaign {
  return {
    id: c.aimId,
    name: c.name,
    niche: c.niche,
    region: c.region,
    replies: c.leadCount,
    status: mapStatus(c.status),
    sender: c.sender,
    senderEmail: c.mailboxEmail ?? c.sender,
    personaId: c.personaId ?? null,
  };
}

function mapStatus(status: string): EngageCampaign['status'] {
  const s = status.toUpperCase();
  if (s === 'COMPLETED' || s === 'OVER' || s === 'DONE') return 'OVER';
  if (s === 'RUNNING' || s === 'SENDING' || s === 'ACTIVE' || s === 'IN_CAMPAIGN') {
    return 'IN CAMPAIGN';
  }
  return 'NEW';
}

const UI_CATEGORIES: ReplyCategory[] = [
  'INTERESTED',
  'UNSURE',
  'TEMP',
  'NOT INTERESTED',
];

function mapReply(r: BackendReply): CampaignReply {
  const category = (UI_CATEGORIES as string[]).includes(r.category)
    ? (r.category as ReplyCategory)
    : 'UNSURE';
  return {
    id: r.id,
    campaignId: r.campaignId,
    company: r.company,
    contact: r.contact,
    time: relativeTime(r.time),
    category,
    inboundPreview: r.inboundPreview,
    inboundBody: r.inboundBody,
    draftSubject: r.draftSubject,
    draftBody: r.draftBody,
    thread: r.thread.map((m) => ({
      id: m.id,
      direction: m.direction,
      header: m.header,
      subject: m.subject,
      body: m.body,
    })),
    sender: '',
    senderEmail: '',
    confidence: r.confidence,
    reasoning: r.reasoning,
    recommendedAction: r.recommendedAction,
    followUpWindow: r.followUpWindow,
    handled: r.handled,
    draftSource: r.draftSource,
    citations: r.citations,
  };
}

// ISO -> compact relative label ("2h", "1d") matching the existing UI copy.
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
