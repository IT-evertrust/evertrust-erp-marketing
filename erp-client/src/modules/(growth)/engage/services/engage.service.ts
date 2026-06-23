import { API_URL } from '@/lib/env';

import type {
  CampaignReply,
  EngageCampaign,
  ReplyThreadMessage,
} from '../types';

// ---- new backend shapes (erp-server /engage: campaign → leads → Gmail threads) ----
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
}

interface BackendLead {
  id: string;
  company: string;
  email: string | null;
  contactName: string | null;
  contactTitle: string | null;
  website: string | null;
  location: string | null;
  status: string;
}

interface BackendThreadMessage {
  id: string;
  threadId: string | null;
  snippet: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  internalDate: string | null;
  labelIds: string[];
}

interface BackendThreadsResult {
  configured: boolean;
  account: { email: string } | null;
  messages: BackendThreadMessage[];
  reason: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// The new model searches Gmail threads live per lead — there is no inbox-to-DB sync
// step. Kept as a resolved no-op so the page-load flow (sync → campaigns) is unchanged.
export async function syncEngageInbox(): Promise<{
  accounts: number;
  scanned: number;
  matched: number;
  ingested: number;
}> {
  return { accounts: 0, scanned: 0, matched: 0, ingested: 0 };
}

// Campaigns = Reach AIMs (with lead count + the mailbox they send from), mapped into
// the table's EngageCampaign shape. `replies` shows the lead count (the conversations
// the campaign can have) until per-thread counts are available.
export async function getEngageCampaigns(): Promise<EngageCampaign[]> {
  const data = await getJson<BackendCampaign[]>('/engage/campaigns');
  return data.map(mapCampaign);
}

// The bottom "Reply Sorter" list for a campaign: each lead's Gmail thread (searched by
// the lead's client email) mapped into the CampaignReply shape. Leads with no thread
// (or before Gmail read access is granted) are omitted. Searches run in parallel.
export async function getCampaignReplies(
  campaignId: string,
): Promise<CampaignReply[]> {
  if (!campaignId) return [];

  const leads = await getJson<BackendLead[]>(
    `/engage/campaigns/${campaignId}/leads`,
  );
  const withEmail = leads.filter((l) => !!l.email);

  const results = await Promise.all(
    withEmail.map(async (lead) => {
      try {
        const res = await getJson<BackendThreadsResult>(
          `/engage/threads?email=${encodeURIComponent(lead.email as string)}`,
        );
        if (!res.configured || res.messages.length === 0) return null;
        return mapReply(campaignId, lead, res.messages);
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is CampaignReply => r !== null);
}

// Draft/send compose is not part of the read-only thread view yet. Kept with the same
// (replyId, subject, body) signature the UI calls so nothing breaks; wire to a real
// endpoint when the compose layer is added back.
export async function saveReplyDraft(
  _replyId: string,
  _subject: string,
  _body: string,
): Promise<void> {
  /* no-op until the thread compose layer is rebuilt */
}

export async function sendReply(
  _replyId: string,
  _subject: string,
  _body: string,
): Promise<void> {
  throw new Error('Sending replies from the thread view is not enabled yet.');
}

// ---- mappers: new backend shape -> the UI's local view types (UI is untouched) ----
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
  };
}

// Reach AIM status -> the table's NEW | IN CAMPAIGN | OVER vocabulary.
function mapStatus(status: string): EngageCampaign['status'] {
  const s = status.toUpperCase();
  if (s === 'COMPLETED' || s === 'OVER' || s === 'DONE') return 'OVER';
  if (s === 'RUNNING' || s === 'SENDING' || s === 'ACTIVE' || s === 'IN_CAMPAIGN') {
    return 'IN CAMPAIGN';
  }
  return 'NEW';
}

function mapReply(
  campaignId: string,
  lead: BackendLead,
  messages: BackendThreadMessage[],
): CampaignReply {
  const leadEmail = (lead.email ?? '').toLowerCase();
  const ordered = [...messages].sort(
    (a, b) => msgTime(a.internalDate, a.date) - msgTime(b.internalDate, b.date),
  );
  const latest = ordered[ordered.length - 1];
  const latestInbound = [...ordered]
    .reverse()
    .find((m) => isInbound(m, leadEmail));

  return {
    id: lead.id,
    campaignId,
    company: lead.company,
    contact: lead.email ?? '',
    time: relativeTime(latest?.date ?? null),
    // No AI classification in the thread view — neutral by default.
    category: 'UNSURE',
    inboundPreview: (latestInbound ?? latest)?.snippet ?? '',
    inboundBody: (latestInbound ?? latest)?.snippet ?? '',
    draftSubject: '',
    draftBody: '',
    thread: ordered.map((m) => mapThread(m, lead.company, leadEmail)),
    sender: '',
    senderEmail: '',
  };
}

function isInbound(m: BackendThreadMessage, leadEmail: string): boolean {
  return (m.from ?? '').toLowerCase().includes(leadEmail);
}

function mapThread(
  m: BackendThreadMessage,
  company: string,
  leadEmail: string,
): ReplyThreadMessage {
  const inbound = isInbound(m, leadEmail);
  const when = relativeTime(m.date);
  const them = company.toUpperCase();
  const header = inbound
    ? `${them} → EVERTRUST${when ? ` · ${when}` : ''}`
    : `EVERTRUST → ${them}${when ? ` · ${when}` : ''}`;
  return {
    id: m.id,
    direction: inbound ? 'inbound' : 'outbound',
    header,
    subject: m.subject ?? '(no subject)',
    // Gmail metadata read gives headers + snippet only (no full body).
    body: m.snippet ?? '',
  };
}

function msgTime(internalDate: string | null, date: string | null): number {
  if (internalDate && /^\d+$/.test(internalDate)) return Number(internalDate);
  if (date) {
    const t = new Date(date).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
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
