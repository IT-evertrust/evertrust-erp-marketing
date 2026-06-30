export type ReachTab = 'scraper' | 'generator' | 'sender';

export type CampaignStatus = 'NEW' | 'SCRAPING' | 'IN CAMPAIGN' | 'OVER';

export type Campaign = {
  id: string;
  name: string;
  niche: string;
  region: string;
  companies: number;
  // Total emails sent across all three rounds (cold + follow-up + final). Drives
  // the Email Generator tab's "Sent" column; Lead Scraper shows `companies`.
  sent: number;
  status: CampaignStatus;
};

export type LeadStatus =
  | 'New'
  | 'Cold Outreach'
  | 'Followed Up'
  | 'Interested'
  | 'Unsure'
  | 'Not Interested';

export type Lead = {
  id: string;
  company: string;
  contact: string;
  location: string;
  source: string;
  status: LeadStatus;
};

export type EmailStatus = 'DRAFT' | 'SENT' | 'SCHEDULED';

export type CampaignEmail = {
  id: string;
  // Stable keys for i18n: `step` is the round id (reach.generator.step.<step>),
  // `round` is the round number 1..3 (reach.generator.round.<round>). The display
  // text is resolved in the component via next-intl, never stored here.
  step: ReachRound;
  round: number;
  subject: string;
  body?: string;
  status: EmailStatus;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  meetings: number;
};

export type SenderSchedule = {
  id: string;
  campaign: string;
  nicheRegion: string;
  round: string;
  // null = the default "tomorrow 09:00" slot (translated at render); '-' = none.
  nextSend: string | null;
  status: CampaignStatus;
  // Aggregate email stats across the three rounds (for the Sequence Sender).
  sent: number;
  opened: number;
  replied: number;
  meetings: number;
  // Reach Bazooka toggle state for this campaign.
  autoSend: boolean;
};

// One point in the Sequence Sender's past-7-days send-volume chart (oldest first).
// `date` is a pre-formatted label (e.g. "12/6" or "Today"); `type` marks the bar
// style — past (filled), today (highlighted), future (projected, dashed).
export type DailySend = {
  date: string;
  value: number;
  type: 'past' | 'today' | 'future';
};

export type NewCampaignFormValues = {
    name: string;
    niche: string;
    country: string;
    region: string;
    // Free-text target descriptor (HTML "Segment", e.g. "Portfolio holders ≥ 500
    // units"). Maps to the backend aim's optional `segment` field. Optional so the
    // preserved legacy modal (which doesn't collect it) still type-checks.
    segment?: string;
    project: string;
    gmailLabel: string;
    whatsappNumber: string;
    sender: string;
    salesCalendarId: string;
    // NOTE: {{Type}} / {{IndustryFocus}} / {{TenderFocus}} are no longer collected here —
    // the server derives them from the selected niche's Sector at create time.
}

// A campaign enriched with the Ammo Forge output (templates + news brief) and the
// raw backend status. The campaign tables consume the Campaign subset; the Email
// Generator reads `templates`/`newsBrief`. `aimStatus` is the unmapped lifecycle.
export type EmailBlock = { subject: string; body: string };
export type ReachTemplates = {
  cold_outreach: EmailBlock;
  follow_up: EmailBlock;
  final_push: EmailBlock;
};
export type ReachNewsBrief = { title: string; body: string };
export type AimStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type ReachRound = 'cold' | 'followup' | 'final';
export type RoundStats = {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  meetings: number;
};
export type ReachStats = {
  cold: RoundStats;
  followup: RoundStats;
  final: RoundStats;
};

export type ReachCampaignView = Campaign & {
  aimStatus: AimStatus;
  templates: ReachTemplates | null;
  newsBrief: ReachNewsBrief | null;
  stats: ReachStats;
  autoSend: boolean;
  sender: string;
  // True when `templates` is the org-wide default (the single source of truth)
  // rather than a per-campaign template. Drives the Email Generator's read-only
  // "org default" treatment.
  usingOrgDefault?: boolean;
  // Targeting hints carried back from the create-aim payload; feed the default
  // template's placeholders.
  targetType?: string;
  industryFocus?: string;
  tenderFocus?: string;
  // Async scrape tracking — server-seeded so the ETA countdown is correct even
  // after navigating away and back (null unless the aim is/has been scraping).
  scrapeStartedAt: string | null;
  scrapeEtaSeconds: number | null;
  // Reason the last scrape failed (shown when aimStatus === 'FAILED'); null otherwise.
  scrapeError: string | null;
};