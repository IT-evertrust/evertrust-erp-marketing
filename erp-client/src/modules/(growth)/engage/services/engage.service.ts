import { API_URL } from '@/lib/env';

import type {
  CampaignReply,
  EngageCampaign,
  ReplyCategory,
  ReplyThreadMessage,
} from '../types';

// ---- backend shapes (erp-server /growth/engage) ----
type BackendCampaignStatus = 'NEW' | 'IN_CAMPAIGN' | 'OVER';

interface BackendCampaign {
  id: string;
  name: string;
  niche: string;
  region: string;
  replies: number;
  status: BackendCampaignStatus;
  sender: string;
  senderEmail: string;
}

interface BackendThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  subject: string;
  body: string;
  sentAt: string | null;
}

interface BackendReply {
  id: string;
  campaignId: string;
  company: string;
  contact: string;
  recipientEmail: string;
  category: 'INTERESTED' | 'UNSURE' | 'NOT_INTERESTED';
  confidence: number | null;
  reasoning: string | null;
  inboundSubject: string;
  inboundPreview: string;
  inboundBody: string;
  draftSubject: string;
  draftBody: string;
  receivedAt: string | null;
  thread: BackendThreadMessage[];
  sender: string;
  senderEmail: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// POST/PATCH helper that surfaces the backend's error message (e.g. the 503 from the
// not-yet-enabled send layer) rather than a bare status code.
async function mutate<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${method} ${path} -> ${res.status}`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json?.message) {
        message = Array.isArray(json.message) ? json.message.join(', ') : json.message;
      }
    } catch {
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// Persist an edited draft (subject + body) for a reply.
export async function saveReplyDraft(
  replyId: string,
  subject: string,
  body: string,
): Promise<void> {
  await mutate('PATCH', `/growth/engage/replies/${replyId}/draft`, { subject, body });
}

// Send the reply via the campaign's Gmail mailbox. Safe by default: in test mode the
// backend redirects to the test recipient. The caller surfaces any error (e.g. 503 when
// the sender mailbox isn't connected).
export async function sendReply(
  replyId: string,
  subject: string,
  body: string,
): Promise<void> {
  await mutate('POST', `/growth/engage/replies/${replyId}/send`, { subject, body });
}

// Sync real inbound Gmail into the queue (match-known-prospects-only). Idempotent and
// best-effort — returns the counts. Called on page load before fetching campaigns.
export async function syncEngageInbox(): Promise<{
  accounts: number;
  scanned: number;
  matched: number;
  ingested: number;
}> {
  return mutate('POST', '/growth/engage/inbox/sync', {});
}

// Campaigns that have engage activity, from the DB-backed backend.
export async function getEngageCampaigns(): Promise<EngageCampaign[]> {
  const data = await getJson<BackendCampaign[]>('/growth/engage/campaigns');
  return data.map(mapCampaign);
}

// The classified replies for one campaign, from the DB-backed backend.
export async function getCampaignReplies(
  campaignId: string,
): Promise<CampaignReply[]> {
  if (!campaignId) return [];
  const data = await getJson<BackendReply[]>(
    `/growth/engage/campaigns/${campaignId}/replies`,
  );
  return data.map(mapReply);
}

// ---- mappers: backend shape -> the UI's local view types (UI is untouched) ----
function mapCampaign(c: BackendCampaign): EngageCampaign {
  return {
    id: c.id,
    name: c.name,
    niche: c.niche,
    region: c.region,
    replies: c.replies,
    status: c.status === 'IN_CAMPAIGN' ? 'IN CAMPAIGN' : c.status,
    sender: c.sender,
    senderEmail: c.senderEmail,
  };
}

function mapCategory(category: BackendReply['category']): ReplyCategory {
  return category === 'NOT_INTERESTED' ? 'NOT INTERESTED' : category;
}

function mapReply(r: BackendReply): CampaignReply {
  return {
    id: r.id,
    campaignId: r.campaignId,
    company: r.company,
    contact: r.contact,
    time: relativeTime(r.receivedAt),
    category: mapCategory(r.category),
    inboundPreview: r.inboundPreview,
    inboundBody: r.inboundBody,
    draftSubject: r.draftSubject,
    draftBody: r.draftBody,
    thread: r.thread.map((m) => mapThread(m, r.company)),
    sender: r.sender,
    senderEmail: r.senderEmail,
  };
}

function mapThread(
  m: BackendThreadMessage,
  company: string,
): ReplyThreadMessage {
  const when = relativeTime(m.sentAt);
  const them = company.toUpperCase();
  const header =
    m.direction === 'outbound'
      ? `EVERTRUST → ${them}${when ? ` · ${when}` : ''}`
      : `${them} → EVERTRUST${when ? ` · ${when}` : ''}`;
  return {
    id: m.id,
    direction: m.direction,
    header,
    subject: m.subject,
    body: m.body,
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
