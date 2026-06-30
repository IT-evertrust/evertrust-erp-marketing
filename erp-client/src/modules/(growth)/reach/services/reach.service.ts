import { API_URL } from '@/lib/env';

import type {
  AimStatus,
  CampaignEmail,
  CampaignStatus,
  DailySend,
  Lead,
  LeadStatus,
  NewCampaignFormValues,
  ReachCampaignView,
  ReachRound,
  ReachStats,
  ReachTemplates,
  ScrapeProgress,
  SenderSchedule,
} from '../types';

const EMPTY_ROUND = {
  sent: 0,
  opened: 0,
  clicked: 0,
  replied: 0,
  bounced: 0,
  meetings: 0,
};
export const EMPTY_STATS: ReachStats = {
  cold: { ...EMPTY_ROUND },
  followup: { ...EMPTY_ROUND },
  final: { ...EMPTY_ROUND },
};

// ---- backend shapes (erp-server /growth/reach) ----
interface BackendAim {
  id: string;
  name: string;
  niche: string;
  country?: string;
  region: string;
  project?: string;
  gmailLabel?: string;
  whatsappNumber?: string;
  salesCalendarId?: string;
  status: AimStatus;
  companies: number;
  scrapeStartedAt?: string | null;
  scrapeEtaSeconds?: number | null;
  scrapeError?: string | null;
  scrapeProgress?: ScrapeProgress | null;
  templates: ReachTemplates | null;
  newsBrief: { title: string; body: string } | null;
  generatedBy: string | null;
  stats: ReachStats | null;
  autoSend: boolean;
  sender: string;
  // When the org has a default template, `templates` IS that org default and
  // this flag is true (the org default is the single source of truth).
  usingOrgDefault?: boolean;
  targetType?: string;
  industryFocus?: string;
  tenderFocus?: string;
  createdAt: string;
  updatedAt: string;
}

interface BackendLead {
  id: string;
  aimId: string;
  company: string;
  website?: string;
  contactName?: string;
  contactTitle?: string;
  email?: string;
  phone?: string;
  location?: string;
  source?: string;
  qualificationReason?: string;
  confidence?: number;
  status:
    | 'NEW'
    | 'COLD_OUTREACHED'
    | 'FOLLOWED_UP'
    | 'INTERESTED'
    | 'UNSURE'
    | 'NOT_INTERESTED';
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
  method: 'POST' | 'PATCH' | 'PUT',
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
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// ---- API ----
export async function getReachCampaigns(): Promise<ReachCampaignView[]> {
  const data = await getJson<BackendAim[]>('/growth/reach/aims');
  return data.map(mapAim);
}

// AIM: create the campaign + generate templates/news (Ammo Forge runs server-side).
export async function createReachAim(
  values: NewCampaignFormValues,
): Promise<ReachCampaignView> {
  const aim = await mutate<BackendAim>('POST', '/growth/reach/aims', {
    name: values.name,
    niche: values.niche,
    country: values.country || undefined,
    region: values.region,
    segment: values.segment || undefined,
    project: values.project || undefined,
    gmailLabel: values.gmailLabel || undefined,
    whatsappNumber: values.whatsappNumber || undefined,
    sender: values.sender || undefined,
    salesCalendarId: values.salesCalendarId || undefined,
    // {{Type}} / {{IndustryFocus}} / {{TenderFocus}} are derived server-side from the
    // niche's Sector — not sent from the form.
  });
  return mapAim(aim);
}

// Trigger Lead Satellite for an aim. The scrape now runs in the BACKGROUND, so this
// returns the campaign marked RUNNING (with the server-seeded ETA) immediately — the
// leads arrive later and are picked up by the campaign-status polling in useReach.
export async function scrapeReachAim(aimId: string): Promise<ReachCampaignView> {
  const aim = await mutate<BackendAim>(
    'POST',
    `/growth/reach/aims/${aimId}/scrape`,
  );
  return mapAim(aim);
}

export async function getCampaignLeads(aimId: string): Promise<Lead[]> {
  if (!aimId) return [];
  const data = await getJson<BackendLead[]>(
    `/growth/reach/aims/${aimId}/leads`,
  );
  return data.map(mapLead);
}

// Record a send for one round (cold | followup | final). Returns the updated
// campaign (with new stats). Delivery is deferred server-side until OAuth lands.
export async function sendCampaignRound(
  aimId: string,
  round: ReachRound,
): Promise<ReachCampaignView> {
  const aim = await mutate<BackendAim>(
    'POST',
    `/growth/reach/aims/${aimId}/send/${round}`,
  );
  return mapAim(aim);
}

// The sender schedule is derived from the campaigns (no extra fetch).
export function getSenderSchedule(
  campaigns: ReachCampaignView[],
): SenderSchedule[] {
  return campaigns.map((c) => {
    const rounds = [c.stats.cold, c.stats.followup, c.stats.final];
    const sum = (k: keyof (typeof rounds)[number]) =>
      rounds.reduce((acc, r) => acc + r[k], 0);
    const roundsSent = rounds.filter((r) => r.sent > 0).length;
    return {
      id: c.id,
      campaign: c.name,
      nicheRegion: `${c.niche} · ${c.region}`,
      round: `${roundsSent} / 3`,
      // null = the default "tomorrow 09:00" slot (translated in the component);
      // '-' = no further send. The next-send schedule is a placeholder until the
      // Reach Bazooka send pipeline lands.
      nextSend: c.status === 'OVER' || roundsSent === 3 ? '-' : null,
      status: c.status,
      sent: sum('sent'),
      opened: sum('opened'),
      replied: sum('replied'),
      meetings: sum('meetings'),
      autoSend: c.autoSend,
    };
  });
}

// ---- Reach Bazooka ----
export type BazookaSummary = {
  campaignsProcessed: number;
  sends: { aimId: string; campaign: string; round: string; count: number }[];
};

// Toggle a campaign's auto-send on/off; returns the updated campaign.
export async function setReachAutoSend(
  aimId: string,
  enabled: boolean,
): Promise<ReachCampaignView> {
  const aim = await mutate<BackendAim>(
    'PATCH',
    `/growth/reach/aims/${aimId}/auto-send`,
    { enabled },
  );
  return mapAim(aim);
}

// Run Bazooka now: advances every auto-send campaign by its next due round.
export async function runReachBazooka(): Promise<BazookaSummary> {
  return mutate<BazookaSummary>('POST', '/growth/reach/bazooka/run');
}

// Real 10-day daily-sends series (oldest first) for the Sequence Sender chart.
// Each point carries its own `type` (past | today | future) so the chart can mark
// the "today" bar distinctly. Returns [] on failure so the chart simply renders
// empty rather than crashing the panel.
export async function getDailySends(): Promise<DailySend[]> {
  return getJson<DailySend[]>('/growth/reach/daily-sends');
}

// ---- Default template + signature (org-wide, used by the Reach Bazooka) ----

// The org's default three-round template; null until one has been saved.
export async function getDefaultTemplate(): Promise<ReachTemplates | null> {
  return getJson<ReachTemplates | null>('/growth/reach/default-template');
}

// Save the org's default template. The backend normalizes either the stored
// keys (cold_outreach/follow_up/final_push) or the pasted
// { COLD, FOLLOWUP, FINALPUSH } shape.
export async function setDefaultTemplate(body: unknown): Promise<void> {
  await mutate<{ ok: true }>('PUT', '/growth/reach/default-template', body);
}

// The org's signature image URL (shown beneath every outbound email).
export async function getSignature(): Promise<{
  signatureImageUrl: string | null;
}> {
  return getJson<{ signatureImageUrl: string | null }>(
    '/growth/reach/signature',
  );
}

// Save (or clear) the org's signature image URL.
export async function setSignature(url: string | null): Promise<void> {
  await mutate<{ ok: true }>('PUT', '/growth/reach/signature', { url });
}

// ---- mappers: backend -> the UI's local view types (UI structure untouched) ----
function mapAimStatus(status: AimStatus): CampaignStatus {
  if (status === 'COMPLETED') return 'IN CAMPAIGN';
  if (status === 'FAILED') return 'OVER';
  if (status === 'RUNNING') return 'SCRAPING';
  return 'NEW'; // DRAFT | READY
}

function mapAim(a: BackendAim): ReachCampaignView {
  const stats = a.stats ?? EMPTY_STATS;
  const sent = stats.cold.sent + stats.followup.sent + stats.final.sent;

  return {
    id: a.id,
    name: a.name,
    niche: a.niche,
    region: a.region,
    companies: a.companies,
    sent,
    status: mapAimStatus(a.status),
    aimStatus: a.status,
    templates: a.templates,
    newsBrief: a.newsBrief,
    stats,
    autoSend: a.autoSend,
    sender: a.sender,
    usingOrgDefault: a.usingOrgDefault ?? false,
    targetType: a.targetType,
    industryFocus: a.industryFocus,
    tenderFocus: a.tenderFocus,
    scrapeStartedAt: a.scrapeStartedAt ?? null,
    scrapeEtaSeconds: a.scrapeEtaSeconds ?? null,
    scrapeError: a.scrapeError ?? null,
    scrapeProgress: a.scrapeProgress ?? null,
  };
}

const LEAD_STATUS: Record<BackendLead['status'], LeadStatus> = {
  NEW: 'New',
  COLD_OUTREACHED: 'Cold Outreach',
  FOLLOWED_UP: 'Followed Up',
  INTERESTED: 'Interested',
  UNSURE: 'Unsure',
  NOT_INTERESTED: 'Not Interested',
};

function mapLead(l: BackendLead): Lead {
  // The Lead Satellite scrapes an EMAIL (and sometimes a phone), not a person's name —
  // so the Contact column falls back to the email/phone when there's no contact name.
  // Without this the scraped email is invisible (the table has no email column).
  const contact =
    [l.contactName, l.contactTitle].filter(Boolean).join(' · ') ||
    l.email ||
    l.phone ||
    '—';
  return {
    id: l.id,
    company: l.company,
    contact,
    location: l.location || '—',
    source: l.source || '—',
    status: LEAD_STATUS[l.status] ?? 'New',
  };
}

// Build the three Email Generator rows from an aim's templates + real stats.
// `sent` drives DRAFT vs SENT; the other metrics are 0 until tracking exists.
// Returns [] when templates haven't been generated yet.
export function templatesToEmails(
  templates: ReachTemplates | null,
  stats: ReachStats,
): CampaignEmail[] {
  if (!templates) return [];
  const row = (
    id: ReachRound,
    round: number,
    block: { subject: string; body: string },
  ): CampaignEmail => {
    const s = stats[id];
    return {
      id,
      step: id,
      round,
      subject: block.subject,
      body: block.body,
      status: s.sent > 0 ? 'SENT' : 'DRAFT',
      sent: s.sent,
      opened: s.opened,
      clicked: s.clicked,
      replied: s.replied,
      bounced: s.bounced,
      meetings: s.meetings,
    };
  };
  return [
    row('cold', 1, templates.cold_outreach),
    row('followup', 2, templates.follow_up),
    row('final', 3, templates.final_push),
  ];
}
