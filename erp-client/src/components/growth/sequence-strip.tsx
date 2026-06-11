'use client';

import { Fragment } from 'react';
import {
  ChevronRight,
  Crosshair,
  MessagesSquare,
  Moon,
  Radar,
  Send,
  type LucideIcon,
} from 'lucide-react';
import type { ArsenalExecutionDto } from '@evertrust/shared';
import {
  useArsenalExecutions,
  useArsenalRuns,
  useArsenalSettings,
} from '@/hooks/use-arsenal';
import { useCampaigns } from '@/hooks/use-campaigns';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ARSENAL_SEQUENCE,
  type RunOutcome,
  type SequenceStep,
  isRunning,
  latestRunFor,
  timeAgo,
} from '@/lib/arsenal-sequence';
import { StatusDot } from './status-dot';
import { RunStageButton } from './run-stage-button';
import { BazookaSchedule, zoneCity } from './bazooka-schedule';

const STEP_ICON: Record<string, LucideIcon> = {
  AIM: Crosshair,
  PREP: Radar,
  REACH_BAZOOKA: Send,
  REPLY_GLOCK: MessagesSquare,
  SLEEPER_GRENADE: Moon,
};

// A node's display state. When the n8n executions poller is configured this comes
// from REAL execution status; otherwise it's the dispatch-based proxy. null = no
// live state to show (AIM, or per-campaign prep when the poller is off).
interface LiveState {
  outcome: RunOutcome;
  at: string | null;
  running: boolean;
}

function fromExec(e: ArsenalExecutionDto | undefined): LiveState | null {
  if (!e) return null;
  if (e.status === 'RUNNING') return { outcome: 'ok', at: e.startedAt, running: true };
  if (e.status === 'ERROR') return { outcome: 'failed', at: e.finishedAt, running: false };
  if (e.status === 'SUCCESS') return { outcome: 'ok', at: e.finishedAt, running: false };
  return { outcome: 'idle', at: null, running: false };
}

// Combine the prep pair (Lead Satellite + Ammo Forge): running if EITHER is running,
// else the most recent finished outcome — so the prep node reflects the post-AIM
// cascade as a whole.
function combineExecs(
  a: ArsenalExecutionDto | undefined,
  b: ArsenalExecutionDto | undefined,
): LiveState | null {
  const da = fromExec(a);
  const db = fromExec(b);
  if (!da && !db) return null;
  if (da?.running || db?.running) {
    const at =
      [da?.running ? da.at : null, db?.running ? db.at : null]
        .filter((x): x is string => !!x)
        .sort()
        .pop() ?? null;
    return { outcome: 'ok', at, running: true };
  }
  const cands = [da, db].filter((x): x is LiveState => !!x);
  cands.sort(
    (x, y) =>
      new Date(y.at ?? 0).getTime() - new Date(x.at ?? 0).getTime(),
  );
  return cands[0] ?? null;
}

// The top "system" map: the whole Arsenal as one ordered, animated sequence. Each
// stage shows its REAL trigger (it runs itself) + live status. When the n8n
// executions poller is configured the dots reflect TRUE n8n run state
// (RUNNING→SUCCESS/ERROR); otherwise they fall back to the dispatch proxy.
export function SequenceStrip() {
  const runs = useArsenalRuns();
  const execs = useArsenalExecutions();
  const settings = useArsenalSettings();
  const campaigns = useCampaigns();

  const runList = runs.data ?? [];
  const campaignCount = campaigns.data?.length ?? 0;
  const execConfigured = execs.data?.configured ?? false;
  const execByStage = new Map(
    (execs.data?.stages ?? []).map((s) => [s.stage, s] as const),
  );

  // Per-step display state: live n8n status when configured, else dispatch proxy.
  const liveFor = (step: SequenceStep): LiveState | null => {
    if (step.kind === 'stage') {
      const stage = step.stages[0]!;
      if (execConfigured) return fromExec(execByStage.get(stage));
      const s = latestRunFor(runList, stage);
      return { outcome: s.outcome, at: s.at, running: isRunning(s) };
    }
    if (step.kind === 'pair' && execConfigured) {
      return combineExecs(
        execByStage.get('LEAD_SATELLITE'),
        execByStage.get('AMMO_FORGE'),
      );
    }
    return null; // AIM launch, or per-campaign prep with the poller off
  };

  // "synced" caption tracks the live poller when configured, else the runs feed.
  const syncedAt = execConfigured ? execs.dataUpdatedAt : runs.dataUpdatedAt;
  const synced =
    (execConfigured ? !execs.isError : !runs.isLoading && !runs.isError)
      ? timeAgo(syncedAt) || 'just now'
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          The sequence
          {synced ? (
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {execConfigured ? 'live · n8n' : 'synced'} {synced}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Every stage runs <strong>automatically</strong> — AIM kicks it off, then
          Lead Satellite &amp; Ammo Forge fire on a Drive poll (~1 min) and the global
          send / reply / sweep run on n8n&apos;s own schedule. The Run buttons just
          trigger a stage early.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
          {ARSENAL_SEQUENCE.map((step, i) => {
            const live = liveFor(step);
            return (
              <Fragment key={step.key}>
                {i > 0 ? (
                  // Always-on flow: a gentle staggered pulse "runs" down the
                  // pipeline (the sequence is live full-time); the connector into a
                  // currently-running step pulses bright emerald, undelayed.
                  <ChevronRight
                    className={cn(
                      'size-4 shrink-0 self-center animate-pulse transition-colors',
                      live?.running
                        ? 'text-emerald-500/90'
                        : 'text-muted-foreground/50',
                    )}
                    style={{
                      animationDelay: live?.running ? '0ms' : `${i * 280}ms`,
                    }}
                  />
                ) : null}
                <StepNode
                  step={step}
                  index={i}
                  live={live}
                  campaignCount={campaignCount}
                  bazookaAt={settings.data?.bazookaDailyAt ?? null}
                  bazookaTz={settings.data?.bazookaTimezone ?? null}
                />
              </Fragment>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          <span className="mr-1 inline-block rounded border border-dashed border-muted-foreground/50 px-1">
            dashed
          </span>
          per campaign (status shown per campaign below) ·
          <span className="mx-1 inline-block rounded border px-1">solid</span>
          global, fires across all campaigns · dot = {execConfigured ? 'live n8n run' : 'last run'}
        </p>

        <BazookaSchedule />
      </CardContent>
    </Card>
  );
}

function StepNode({
  step,
  index,
  live,
  campaignCount,
  bazookaAt,
  bazookaTz,
}: {
  step: SequenceStep;
  index: number;
  live: LiveState | null;
  campaignCount: number;
  bazookaAt: string | null;
  bazookaTz: string | null;
}) {
  const Icon = STEP_ICON[step.key] ?? Crosshair;
  const perCampaign = step.scope === 'PER_CAMPAIGN';
  const isBazooka = step.key === 'REACH_BAZOOKA';
  const running = live?.running ?? false;

  return (
    <div
      className={cn(
        'flex min-w-[9rem] flex-1 flex-col gap-1.5 rounded-lg border p-2.5 transition-shadow',
        perCampaign ? 'border-dashed bg-muted/20' : 'bg-card',
        running && 'border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
          {index + 1}
        </span>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        {live ? (
          <StatusDot outcome={live.outcome} running={running} className="ml-auto" />
        ) : null}
      </div>

      <div className="text-xs font-medium leading-tight">{step.label}</div>

      {/* The stage's REAL trigger — emerald = runs itself, muted = the launch you fire. */}
      <span
        className={cn(
          'w-fit rounded px-1.5 py-0.5 text-[10px] font-medium',
          step.autonomous
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {step.auto}
      </span>

      {perCampaign ? (
        <>
          {live ? (
            <div
              className={cn(
                'text-[11px]',
                running
                  ? 'font-medium text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground',
              )}
            >
              {running
                ? 'running in n8n…'
                : live.at
                  ? `last ${timeAgo(live.at)}`
                  : ''}
            </div>
          ) : null}
          <div className="mt-auto text-[11px] text-muted-foreground">
            {campaignCount > 0
              ? `${campaignCount} campaign${campaignCount === 1 ? '' : 's'} ↓`
              : 'no campaigns yet'}
          </div>
        </>
      ) : (
        <>
          <div
            className={cn(
              'text-[11px]',
              running
                ? 'font-medium text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground',
            )}
          >
            {running
              ? 'running in n8n…'
              : live && live.at
                ? `last ${timeAgo(live.at)}`
                : 'no runs yet'}
          </div>
          {isBazooka && bazookaAt ? (
            <Badge
              variant="outline"
              className="w-fit border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
              title="An extra ERP send on top of n8n's daily 08:00 — may double-send"
            >
              + ERP send {bazookaAt} · {zoneCity(bazookaTz)}
            </Badge>
          ) : null}
          <Can permission="campaigns:write">
            <RunStageButton
              stage={step.stages[0]!}
              label="Run now"
              variant="ghost"
              size="sm"
            />
          </Can>
        </>
      )}
    </div>
  );
}
