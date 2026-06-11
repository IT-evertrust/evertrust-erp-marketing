import {
  ARSENAL_STAGE_META,
  isArsenalRunOk,
  type ArsenalRunDto,
  type ArsenalStage,
  type CampaignDto,
} from '@evertrust/shared';

// The Arsenal as ONE ordered sequence (Growth Engine redesign). AIM is the campaign
// launch (not an ArsenalStage); steps 1–2 are per-campaign, 3–5 are global.
//
// IMPORTANT (verified against the live n8n workflows): the arsenal is ALREADY
// autonomous. It doesn't chain workflow-to-workflow — each stage self-runs:
//   • AIM            — webhook only (the ERP/launch fires it)
//   • Lead Satellite — Google Drive poll (every ~1 min) on new campaign folder
//   • Ammo Forge     — Google Drive poll (every ~1 min) on new campaign folder
//   • Reach Bazooka  — n8n cron, daily 08:00 (Europe/Berlin)
//   • Reply Glock    — n8n cron, every 15 min
//   • Sleeper        — n8n cron, daily 08:15
// So launching AIM kicks the whole thing off on its own; the "Run now" buttons are
// just optional manual nudges (they fire the same webhook early).

export type StepKind = 'launch' | 'pair' | 'stage';
export type StepScope = 'PER_CAMPAIGN' | 'GLOBAL';

export interface SequenceStep {
  key: string;
  label: string;
  scope: StepScope;
  kind: StepKind;
  // The arsenal stage(s) this step fires. Empty for AIM (handled by campaigns).
  stages: ArsenalStage[];
  what: string;
  // How this step runs on its own in n8n (the real trigger). autonomous=false for
  // AIM (it's the launch you fire); true for everything downstream.
  autonomous: boolean;
  auto: string;
}

export const ARSENAL_SEQUENCE: SequenceStep[] = [
  {
    key: 'AIM',
    label: 'AIM',
    scope: 'PER_CAMPAIGN',
    kind: 'launch',
    stages: [],
    what: 'Lock & Load — provision the campaign',
    autonomous: false,
    auto: 'Launches the sequence',
  },
  {
    key: 'PREP',
    label: 'Lead Satellite & Ammo Forge',
    scope: 'PER_CAMPAIGN',
    kind: 'pair',
    stages: ['LEAD_SATELLITE', 'AMMO_FORGE'],
    what: 'Pull leads in, then write the outreach',
    autonomous: true,
    auto: 'Auto · ~1 min after launch',
  },
  {
    key: 'REACH_BAZOOKA',
    label: ARSENAL_STAGE_META.REACH_BAZOOKA.label,
    scope: 'GLOBAL',
    kind: 'stage',
    stages: ['REACH_BAZOOKA'],
    what: ARSENAL_STAGE_META.REACH_BAZOOKA.what,
    autonomous: true,
    auto: 'Auto · daily 08:00',
  },
  {
    key: 'REPLY_GLOCK',
    label: ARSENAL_STAGE_META.REPLY_GLOCK.label,
    scope: 'GLOBAL',
    kind: 'stage',
    stages: ['REPLY_GLOCK'],
    what: ARSENAL_STAGE_META.REPLY_GLOCK.what,
    autonomous: true,
    auto: 'Auto · every 15 min',
  },
  {
    key: 'SLEEPER_GRENADE',
    label: ARSENAL_STAGE_META.SLEEPER_GRENADE.label,
    scope: 'GLOBAL',
    kind: 'stage',
    stages: ['SLEEPER_GRENADE'],
    what: ARSENAL_STAGE_META.SLEEPER_GRENADE.what,
    autonomous: true,
    auto: 'Auto · daily 08:15',
  },
];

// A node's live status, derived from the run history (never a fabricated "complete").
export type RunOutcome = 'ok' | 'failed' | 'idle';
export interface StageStatus {
  outcome: RunOutcome;
  at: string | null; // ISO of the last run, or null when idle
}

// Latest run for a stage. `arsenal_runs` arrives newest-first, so the first match is
// the latest. Pass `campaignId` to scope to one campaign (per-campaign stages);
// omit it for the org-wide latest (global stages).
export function latestRunFor(
  runs: ArsenalRunDto[],
  stage: ArsenalStage,
  campaignId?: string,
): StageStatus {
  const r = runs.find(
    (x) =>
      x.stage === stage &&
      (campaignId === undefined || x.campaignId === campaignId),
  );
  if (!r) return { outcome: 'idle', at: null };
  return {
    outcome: isArsenalRunOk(r.status) ? 'ok' : 'failed',
    at: r.createdAt,
  };
}

// AIM status for a campaign comes from its deploy outcome, not arsenal_runs.
export function aimStatus(c: CampaignDto): StageStatus {
  if (c.status === 'DEPLOYED') {
    return { outcome: 'ok', at: c.deployedAt ?? c.createdAt };
  }
  if (c.status === 'FAILED') {
    return { outcome: 'failed', at: c.deployedAt ?? c.createdAt };
  }
  return { outcome: 'idle', at: null };
}

// Dot colour per outcome (emerald / rose / muted-idle) — matches the runs card.
export const OUTCOME_DOT: Record<RunOutcome, string> = {
  ok: 'bg-emerald-500',
  failed: 'bg-rose-500',
  idle: 'bg-muted-foreground/30',
};

export const OUTCOME_LABEL: Record<RunOutcome, string> = {
  ok: 'dispatched',
  failed: 'failed',
  idle: 'idle',
};

// A node counts as "running" (animated) for a short window after a SUCCESSFUL
// dispatch. Without real n8n execution state this is a dispatch-based proxy that
// auto-settles to a plain "Xm ago" — never a fabricated completion. (The n8n
// executions poller, when configured, replaces this with true RUNNING state.)
export const RUNNING_WINDOW_MS = 90_000;

export function isRunning(status: StageStatus): boolean {
  if (status.outcome !== 'ok' || !status.at) return false;
  return Date.now() - new Date(status.at).getTime() < RUNNING_WINDOW_MS;
}

// Compact relative time ("just now" / "12s ago" / "3m ago" / "2h ago" / "4d ago").
// Client-only (reads the wall clock); fine in 'use client' components.
export function timeAgo(value: string | number | null): string {
  if (value == null) return '';
  const then = typeof value === 'number' ? value : new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const ms = Date.now() - then;
  if (ms < 5_000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
