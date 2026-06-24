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
  region: string;
  segment?: string;
  source?: string;
  status: AimStatus;
  companies: number;
  templates: ReachTemplates | null;
  newsBrief: { title: string; body: string } | null;
  generatedBy: string | null;
  stats: ReachStats | null;
  autoSend: boolean;
  sender: string;
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
  method: 'POST' | 'PATCH',
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
    region: values.region,
    segment: values.segment || undefined,
    source: values.source || undefined,
    sender: values.sender || undefined,
  });
  return mapAim(aim);
}

// Activate Lead Satellite for an aim; returns the stored leads.
export async function scrapeReachAim(aimId: string): Promise<Lead[]> {
  const data = await mutate<BackendLead[]>(
    'POST',
    `/growth/reach/aims/${aimId}/scrape`,
  );
  return data.map(mapLead);
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

// The sender schedule is derived from the campaigns: each row aggregates the
// three rounds' stats. (Daily sends now come from the backend — see
// getDailySends below.)
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
      nextSend:
        c.status === 'OVER' || roundsSent === 3 ? '-' : 'Tomorrow 09:00',
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

// The "Emails sent per day" chart: past + projected daily send volume,
// org-scoped. Same cookie-authed GET shape as the other reach reads.
export async function getDailySends(): Promise<DailySend[]> {
  return getJson<DailySend[]>('/growth/reach/daily-sends');
}

// ---- mappers: backend -> the UI's local view types (UI structure untouched) ----
function mapAimStatus(status: AimStatus): CampaignStatus {
  if (status === 'COMPLETED') return 'IN CAMPAIGN';
  if (status === 'FAILED') return 'OVER';
  return 'NEW'; // DRAFT | READY | RUNNING
}

function mapAim(a: BackendAim): ReachCampaignView {
  return {
    id: a.id,
    name: a.name,
    niche: a.niche,
    region: a.region,
    companies: a.companies,
    status: mapAimStatus(a.status),
    aimStatus: a.status,
    templates: a.templates,
    newsBrief: a.newsBrief,
    stats: a.stats ?? EMPTY_STATS,
    autoSend: a.autoSend,
    sender: a.sender,
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
  const contact =
    [l.contactName, l.contactTitle].filter(Boolean).join(' · ') || '—';
  return {
    id: l.id,
    company: l.company,
    contact,
    location: l.location || '—',
    source: l.source || '—',
    status: LEAD_STATUS[l.status] ?? 'New',
    email: l.email || undefined,
  };
}

// Result of promoting a reach lead into the Nurture pipeline.
export type PromoteResult = {
  campaignId: string;
  prospectId: string;
  created: boolean;
};

// Reach → Nurture bridge: promote a lead into the Nurture pipeline (server
// find-or-creates the aim's CRM campaign and upserts the prospect at INTEREST).
export async function promoteReachLead(
  aimId: string,
  leadId: string,
): Promise<PromoteResult> {
  return mutate<PromoteResult>(
    'POST',
    `/growth/reach/aims/${aimId}/leads/${leadId}/promote`,
  );
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
    step: string,
    roundLabel: string,
    block: { subject: string; body: string },
  ): CampaignEmail => {
    const s = stats[id];
    return {
      id,
      step,
      round: roundLabel,
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
    row('cold', 'Cold Outreach', 'Round 1', templates.cold_outreach),
    row('followup', 'Follow Up', 'Round 2', templates.follow_up),
    row('final', 'Final Push', 'Round 3', templates.final_push),
  ];
}
