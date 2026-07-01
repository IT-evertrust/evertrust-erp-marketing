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

// Live per-phase scrape progress (pushed by the Lead Satellite agent during a run).
export type ScrapePhase = 'search' | 'scrape' | 'qualify' | 'load';
export type ScrapeProgress = {
  phase: ScrapePhase;
  current: number;
  total: number;
  label: string;
  updatedAt: string;
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
  // Per-campaign template placeholders for the org default outreach template:
  //   {{Type}} → targetType, {{IndustryFocus}} → industryFocus, {{TenderFocus}} → tenderFocus.
  targetType?: string;
  industryFocus?: string;
  tenderFocus?: string;
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
  // The BASE lead-scraping prompt authored by the local model from this aim's config, to
  // be pasted into OpenAI to run the scrape. Null until Generate Prompt has been run.
  // Batches 2-4 append a "Previously Collected Companies" exclusion block to this base.
  scrapePrompt: string | null;
  // Which batch of the 4-batch dedup sweep this campaign is on (1..4).
  scrapeBatch: number;
  // Live per-phase progress pushed by the agent during a run (search → scrape →
  // qualify → load). Null when idle. Drives the per-process countdown in the UI.
  scrapeProgress: ScrapeProgress | null;
  // Which mailbox the campaign sends from (info | hanna).
  sender: string;
  // Ammo Forge output (null until generated). getAims overrides this with the org
  // default template (single source) and sets `usingOrgDefault` when one is set.
  templates: ReachTemplates | null;
  usingOrgDefault?: boolean;
  newsBrief: ReachNewsBrief | null;
  generatedBy: string | null;
  // Per-round send/engagement stats (always present; zeros until sends happen).
  stats: ReachStats;
  // Reach Bazooka on/off toggle.
  autoSend: boolean;
  createdAt: string;
  updatedAt: string;
};

// One day on the Reach daily-sends timeline (past-7-days window, oldest first).
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

// ---- 4-batch dedup sweep ----
// The sweep runs TOTAL_BATCHES rounds of ~BATCH_SIZE companies; each round after the
// first excludes every company already collected, so the ~100 leads are unique.
export const REACH_TOTAL_BATCHES = 4;
export const REACH_BATCH_SIZE = 25;

// The state of a campaign's batch sweep, returned to the UI and after each ingest.
export type ReachBatchState = {
  batch: number; // current batch (1..TOTAL_BATCHES); === TOTAL_BATCHES+1 when finished
  totalBatches: number;
  batchSize: number;
  // The current batch's full prompt (base + accumulated exclusion block), or null when
  // no base prompt has been generated yet, or when the sweep is done.
  prompt: string | null;
  collectedCount: number; // distinct companies collected so far for this aim
  done: boolean; // true once all batches are complete
};

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
  state?: string;
  revenueTier?: string;
  source?: string;
  qualificationReason?: string;
  confidence?: number;
  status: ReachLeadStatus;
  createdAt: string;
  updatedAt: string;
};
