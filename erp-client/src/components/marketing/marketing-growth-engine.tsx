'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import {
  ARSENAL_STAGE_META,
  STAGE_PRIMARY_METRIC,
  type ArsenalStage,
} from '@evertrust/shared';
import {
  useArsenalBackfill,
  useArsenalRuns,
  useMarketingReport,
} from '@/hooks/use-arsenal';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { isRunning, latestRunFor, timeAgo } from '@/lib/arsenal-sequence';
import { RunStageButton } from '@/components/growth/run-stage-button';
import { StatusDot } from '@/components/growth/status-dot';

// The arsenal pipeline in launch order, each stage tagged with its AIM-sequence
// codename (mockup parity). Maps 1:1 to the real ArsenalStage values.
const PIPELINE: {
  stage: ArsenalStage;
  code: string;
  phase: string;
  short: string;
}[] = [
  { stage: 'LEAD_SATELLITE', code: '01', phase: 'Target', short: 'Lead Sat' },
  { stage: 'AMMO_FORGE', code: '02', phase: 'Arm', short: 'Ammo' },
  { stage: 'REACH_BAZOOKA', code: '03', phase: 'Fire', short: 'Bazooka' },
  { stage: 'REPLY_GLOCK', code: '04', phase: 'Catch', short: 'Glock' },
  { stage: 'SLEEPER_GRENADE', code: '05', phase: 'Revive', short: 'Sleeper' },
];

// Marketing → "Growth Engine" tab (mockup design): AIM toolbar + a live engine
// status strip + the arsenal as a 6-card sequence pipeline. Per-stage counts are
// REAL (the primary metric from arsenal_runs); "—" until n8n reports one.
export function MarketingGrowthEngine() {
  const report = useMarketingReport('week', null);
  const runs = useArsenalRuns();
  const backfill = useArsenalBackfill();

  const runList = runs.data ?? [];
  const stageReport = new Map(
    (report.data?.stages ?? []).map((s) => [s.stage, s] as const),
  );

  const countFor = (stage: ArsenalStage): number | null => {
    const s = stageReport.get(stage);
    if (!s) return null;
    const v = s.metrics[STAGE_PRIMARY_METRIC[stage]];
    return v === undefined ? null : v;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Can permission="campaigns:write">
          <Button
            type="button"
            variant="outline"
            onClick={() => backfill.mutate()}
            disabled={backfill.isPending}
            title="Import recent runs + counts from n8n's execution history"
          >
            {backfill.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {backfill.isPending ? 'Syncing…' : 'Sync'}
          </Button>
        </Can>
        <p className="ml-auto text-xs text-muted-foreground">
          AIM launches a campaign; the arsenal runs the rest on its own schedule.
        </p>
      </div>

      {/* engine status strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/20 px-4 py-2.5 text-xs">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Engine
        </span>
        {PIPELINE.map((p) => {
          const st = latestRunFor(runList, p.stage);
          const c = countFor(p.stage);
          return (
            <span
              key={p.stage}
              className="inline-flex items-center gap-1.5 text-muted-foreground"
            >
              <StatusDot outcome={st.outcome} running={isRunning(st)} />
              {p.short}{' '}
              <b className="text-foreground tabular-nums">{c === null ? '—' : c}</b>
            </span>
          );
        })}
      </div>

      {/* AIM sequence pipeline */}
      <div>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          AIM sequence — the arsenal pipeline
        </p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {PIPELINE.map((p) => {
            const st = latestRunFor(runList, p.stage);
            const running = isRunning(st);
            const c = countFor(p.stage);
            return (
              <div
                key={p.stage}
                className={cn(
                  'flex flex-col rounded-xl border bg-card p-3',
                  running &&
                    'border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    {p.code} · {p.phase}
                  </span>
                  <StatusDot outcome={st.outcome} running={running} />
                </div>
                <div className="mt-1 text-sm font-semibold leading-tight">
                  {ARSENAL_STAGE_META[p.stage].label}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {running
                    ? 'running…'
                    : st.at
                      ? `last ${timeAgo(st.at)}`
                      : 'no runs yet'}
                </div>
                <div className="mt-2 text-2xl font-bold tabular-nums">
                  {report.isLoading ? (
                    <Skeleton className="h-7 w-8" />
                  ) : c === null ? (
                    <span className="text-muted-foreground/50">—</span>
                  ) : (
                    c
                  )}
                </div>
                <Can permission="campaigns:write">
                  <RunStageButton
                    stage={p.stage}
                    label="Run"
                    variant="outline"
                    size="sm"
                  />
                </Can>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
