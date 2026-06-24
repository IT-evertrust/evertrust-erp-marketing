import type { PipelineStage } from '@evertrust/shared';

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
  segment?: string;
  source?: string;
  // Optional config fields consumed by the agent CampaignConfig. The reach_aims
  // table does not yet expose these columns in this build, so they are undefined
  // until surfaced from the DB; buildAgentConfig falls back to name / 'Germany'.
  project?: string;
  country?: string;
  status: AimStatus;
  companies: number;
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

// One point on the daily email-send chart (last 10 days ending today).
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
  // Nurture pipeline fields (the lead IS the Nurture card).
  pipelineStage: PipelineStage;
  dealValue: number;
  // The lead's campaign niche (from reach_aims), for the Nurture card tag + filter.
  niche?: string;
  createdAt: string;
  updatedAt: string;
};

// The Nurture board payload: leads for the org (optionally one aim), plus full-set
// tallies by pipeline stage + outreach status (independent of the page window).
export type ReachBoardResult = {
  items: ReachLead[];
  total: number;
  statusCounts: Record<string, number>;
  stageCounts: Record<PipelineStage, number>;
};
