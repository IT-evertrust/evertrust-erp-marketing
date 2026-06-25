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
  personaId: string | null;
  handled: boolean;
  thread: BackendThreadMessage[];
  time: string;
  // Meeting-loop state (propose → accept/counter → book).
  meetingStatus?: string;
  proposedSlots?: { start: string; end: string }[];
  acceptedSlot?: { start: string; end: string } | null;
  bookedMeetingId?: string | null;
  timeZone?: string;
  secondaryTimeZone?: string | null;
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

// Result of a manual scan (mirrors the server CampaignScanResult).
export interface EngageScanResult {
  configured: boolean;
  scanned: number;
  classified: number;
  byCategory: Record<string, number>;
  skipped: number;
  reason: string | null;
}

// Manual "Scan now" — read the campaign's mailbox for new replies, classify + draft
// each, and persist. SLOW (~35s/lead on local Hermes); the queue reads the result.
export async function scanCampaign(aimId: string): Promise<EngageScanResult> {
  return mutate<EngageScanResult>('POST', `/engage/campaigns/${aimId}/scan`);
}

// Scan a whole inbox: rescans every campaign that sends from `email` for new replies
// to its outreaches. Used by the inbox toggle's "Scan now".
export async function scanInbox(
  email: string,
): Promise<{ aims: number; scanned: number; classified: number }> {
  return mutate('POST', `/engage/scan-inbox?email=${encodeURIComponent(email)}`);
}

// Scan EVERY campaign in the org (the same work the hourly auto-scan does). Backs
// the manual "Scan all" button. SLOW — sequential per campaign on the local model.
export async function scanAllInboxes(): Promise<{
  aims: number;
  scanned: number;
  classified: number;
}> {
  return mutate('POST', '/engage/scan-all');
}

// A connected Google mailbox (one of the org's linked accounts — incl. colleagues').
// Backs the inbox filter so any linked inbox can be reviewed, not just campaign senders.
export interface EngageAccount {
  id: string;
  email: string;
  displayName: string | null;
}

// List every Google mailbox connected to this org. Used to populate the inbox
// filter with all linked inboxes (so you can see other users' inboxes too).
export async function getEngageAccounts(): Promise<EngageAccount[]> {
  const data = await getJson<
    { id?: string; email?: string; displayName?: string | null }[]
  >('/engage/accounts');
  return data.flatMap((a) =>
    a.id && a.email
      ? [{ id: a.id, email: a.email, displayName: a.displayName ?? null }]
      : [],
  );
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

// A single proposable meeting window (ISO-8601 start/end), as returned by the
// calendar free-slots endpoint.
export interface CalendarSlot {
  start: string;
  end: string;
}

// GET /engage/campaigns/:aimId/free-slots. `configured:false` (with `reason`) means
// the campaign's calendar isn't readable, so no slots can be offered.
export interface FreeSlots {
  configured: boolean;
  slots: CalendarSlot[];
  reason: string | null;
  timeZone: string;
  secondaryTimeZone?: string;
}

// Result of sending a reply, including the optional tentative calendar event the
// server creates when a `proposedSlot` is supplied.
export interface SendReplyResult {
  ok: true;
  meeting: { ok: boolean; eventId: string | null; htmlLink: string | null } | null;
}

// Read the campaign calendar's bookable windows so the rep can propose a meeting time.
export async function getCampaignFreeSlots(aimId: string): Promise<FreeSlots> {
  return getJson<FreeSlots>(`/engage/campaigns/${aimId}/free-slots`);
}

// Send the (edited) draft to the lead, threaded onto the existing conversation.
// When `proposedSlot` is supplied the server also creates a tentative calendar event
// (with a Meet link) for that window and invites the lead.
export async function sendReply(
  replyId: string,
  subject: string,
  body: string,
  proposedSlot?: CalendarSlot,
  // The full set of windows offered this round — persisted so a later scan can match
  // the client's accept/counter against the exact times we put on the table.
  proposedSlots?: CalendarSlot[],
): Promise<SendReplyResult> {
  const payload: {
    subject: string;
    body: string;
    proposedSlot?: CalendarSlot;
    proposedSlots?: CalendarSlot[];
  } = { subject, body };
  if (proposedSlot) payload.proposedSlot = proposedSlot;
  if (proposedSlots && proposedSlots.length > 0) payload.proposedSlots = proposedSlots;
  return mutate<SendReplyResult>(
    'POST',
    `/engage/campaign-replies/${replyId}/send`,
    payload,
  );
}

// Mark a reply BOOKED and link the created Activate meeting to the campaign reply,
// closing the meeting loop. Called after a successful book from the accepted-slot banner.
export async function markReplyBooked(
  replyId: string,
  meetingId: string,
): Promise<void> {
  await mutate('PATCH', `/engage/campaign-replies/${replyId}/booked`, {
    meetingId,
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

// Create a new drafting persona (name + voice rules). Returns the picker shape.
export async function createEngagePersona(
  name: string,
  rules: string,
): Promise<EngagePersona> {
  return mutate<EngagePersona>('POST', '/engage/personas', { name, rules });
}

// One persona's detail incl. its current voice rules — for the edit dialog.
export interface EngagePersonaDetail {
  id: string;
  name: string;
  rules: string;
}
export async function getEngagePersona(id: string): Promise<EngagePersonaDetail> {
  return getJson<EngagePersonaDetail>(`/engage/personas/${id}`);
}

// Edit an existing persona's name and/or rules. Returns the picker shape.
export async function updateEngagePersona(
  id: string,
  updates: { name?: string; rules?: string },
): Promise<EngagePersona> {
  return mutate<EngagePersona>('PATCH', `/engage/personas/${id}`, updates);
}

// Re-draft every unhandled reply in a campaign in its current persona voice. Run
// after switching the persona so the queue reflects the new voice. SLOW (LLM/reply).
export async function redraftCampaign(
  aimId: string,
): Promise<{ redrafted: number; failed: number; total: number }> {
  return mutate('POST', `/engage/campaigns/${aimId}/redraft-all`);
}

// Set (or clear, personaId=null) the campaign's drafting persona.
export async function setCampaignPersona(
  aimId: string,
  personaId: string | null,
): Promise<void> {
  await mutate('PATCH', `/engage/campaigns/${aimId}/persona`, { personaId });
}

// Set (or clear) the drafting persona for ONE reply. Persisted, no redraft.
export async function setReplyPersona(
  replyId: string,
  personaId: string | null,
): Promise<void> {
  await mutate('PATCH', `/engage/campaign-replies/${replyId}/persona`, {
    personaId,
  });
}

// Re-draft one reply fresh in its current per-reply persona voice.
export async function redraftReplyPersona(
  replyId: string,
): Promise<{ draftSubject: string; draftBody: string }> {
  return mutate('POST', `/engage/campaign-replies/${replyId}/redraft-persona`);
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
  // The persona whose prompt the note should adjust (the selected per-email persona).
  // null = the campaign's default persona.
  personaId: string | null = null,
): Promise<void> {
  await mutate('POST', `/engage/campaigns/${aimId}/training`, {
    note,
    personaId,
  });
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

// Book a meeting from an INTERESTED reply (the Engage→Activate handoff). Creates a
// Google Calendar event (+ Meet link) on the campaign's mailbox and records it; the
// event then shows up in Activate's Meeting Booker.
export interface BookMeetingInput {
  company: string;
  contactName?: string;
  clientEmail: string;
  startsAt: string; // ISO
  durationMinutes?: number;
  title?: string;
  notes?: string;
  accountId?: string; // the campaign's mailbox google_accounts id
}

export async function bookMeeting(
  input: BookMeetingInput,
): Promise<{ id: string; title: string; joinUrl: string | null; startsAt: string | null }> {
  return mutate('POST', '/growth/activate/meetings', input);
}

// ---- mappers: backend shape -> the UI's local view types (UI is untouched) ----
function mapCampaign(c: BackendCampaign): EngageCampaign {
  return {
    id: c.aimId,
    name: c.name,
    niche: c.niche,
    region: c.region,
    leadCount: c.leadCount,
    status: mapStatus(c.status),
    sender: c.sender,
    senderEmail: c.mailboxEmail ?? c.sender,
    personaId: c.personaId ?? null,
    mailboxAccountId: c.mailboxAccountId ?? null,
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
    personaId: r.personaId ?? null,
    meetingStatus: mapMeetingStatus(r.meetingStatus),
    acceptedSlot: r.acceptedSlot ?? undefined,
    proposedSlots: r.proposedSlots ?? [],
    bookedMeetingId: r.bookedMeetingId ?? undefined,
    timeZone: r.timeZone,
    secondaryTimeZone: r.secondaryTimeZone ?? null,
  };
}

const MEETING_STATUSES: CampaignReply['meetingStatus'][] = [
  'NONE',
  'PROPOSED',
  'ACCEPTED',
  'COUNTER',
  'BOOKED',
];

function mapMeetingStatus(status?: string): CampaignReply['meetingStatus'] {
  const s = (status ?? '').toUpperCase();
  return (MEETING_STATUSES as string[]).includes(s)
    ? (s as CampaignReply['meetingStatus'])
    : 'NONE';
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
