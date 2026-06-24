export type AimStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type EmailBlock = { subject: string; body: string };

export type ReachTemplates = {
  cold_outreach: EmailBlock;
  follow_up: EmailBlock;
  final_push: EmailBlock;
};

export type ReachNewsBrief = { title: string; body: string };

// The three outreach rounds.
export type ReachRound = 'cold' | 'followup' | 'final';

// Per-round stats. `sent` is real (Send action); the rest are 0 until tracking.
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

export const EMPTY_ROUND_STATS: RoundStats = {
  sent: 0,
  opened: 0,
  clicked: 0,
  replied: 0,
  bounced: 0,
  meetings: 0,
};

export const EMPTY_STATS: ReachStats = {
  cold: { ...EMPTY_ROUND_STATS },
  followup: { ...EMPTY_ROUND_STATS },
  final: { ...EMPTY_ROUND_STATS },
};

export type ReachAim = {
  id: string;
  name: string;
  niche: string;
  region: string;
  // AIM config (mirrors the old Lock & Load fields; nullable on legacy rows).
  country?: string;
  project?: string;
  gmailLabel?: string;
  whatsappNumber?: string;
  salesCalendarId?: string;
  // Legacy reach fields (no longer collected by the AIM modal).
  segment?: string;
  source?: string;
  // The Growth-Engine campaign this aim is linked to (1:1). Null on legacy aims.
  campaignId: string | null;
  status: AimStatus;
  companies: number;
  // Async scrape tracking (Lead Satellite runs in the background). startedAt + eta
  // drive the ETA countdown (server-seeded so it survives navigation); lastSeconds
  // seeds the next run's estimate. Null until the aim has been scraped.
  scrapeStartedAt: string | null;
  scrapeEtaSeconds: number | null;
  scrapeLastSeconds: number | null;
  // Reason the last scrape failed (agent error / timeout), shown in the UI. Null when
  // the aim hasn't failed (cleared on a new run + on success).
  scrapeError: string | null;
  // Which mailbox the campaign sends from (info | hanna).
  sender: string;
  // Ammo Forge output (null until generated).
  templates: ReachTemplates | null;
  newsBrief: ReachNewsBrief | null;
  generatedBy: string | null;
  // Per-round send/engagement stats (always present; zeros until sends happen).
  stats: ReachStats;
  // Reach Bazooka on/off toggle.
  autoSend: boolean;
  createdAt: string;
  updatedAt: string;
};

// One day on the Reach daily-sends timeline (10-day window, oldest first).
export type DailySendPoint = {
  date: string;
  value: number;
  type: 'past' | 'today' | 'future';
};

// Summary returned by a Reach Bazooka run.
export type BazookaRunSummary = {
  campaignsProcessed: number;
  sends: { aimId: string; campaign: string; round: ReachRound; count: number }[];
};

// Which tracking signal a tracking endpoint records.
export type TrackKind = 'open' | 'click' | 'reply';

export type ReachLeadStatus =
  | 'NEW'
  | 'COLD_OUTREACHED'
  | 'FOLLOWED_UP'
  | 'INTERESTED'
  | 'UNSURE'
  | 'NOT_INTERESTED';

export type ReachLead = {
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
  status: ReachLeadStatus;
  createdAt: string;
  updatedAt: string;
};
