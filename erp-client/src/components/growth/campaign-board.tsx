'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  XCircle,
} from 'lucide-react';
import {
  ARSENAL_STAGE_META,
  isArsenalRunOk,
  type ArsenalRunDto,
  type ArsenalRunStatus,
  type ArsenalStage,
  type CampaignDto,
  type CampaignStatus,
} from '@evertrust/shared';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useArsenalRuns } from '@/hooks/use-arsenal';
import { Can } from '@/components/auth/can';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import {
  ARSENAL_SEQUENCE,
  aimStatus,
  isRunning,
  latestRunFor,
  timeAgo,
  type StageStatus,
} from '@/lib/arsenal-sequence';
import { StatusDot } from './status-dot';
import { RunStageButton } from './run-stage-button';
import { DeleteCampaignButton } from './delete-campaign-button';

const STATUS_BADGE: Record<CampaignStatus, { label: string; className: string }> = {
  DRAFT: {
    label: 'Draft',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  DEPLOYED: {
    label: 'Deployed',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  FAILED: {
    label: 'Failed',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
};

const RUN_STATUS_LABEL: Record<ArsenalRunStatus, string> = {
  DISPATCHED: 'Dispatched',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  ERROR: 'Error',
};

const MAX_ACTIVITY = 10;
const GLOBAL_KEY = '__global__';

// The per-campaign stages of the sequence (the "prep pair": Lead Satellite, Ammo
// Forge). AIM is rendered from the campaign's deploy status.
const PREP_STAGES: ArsenalStage[] =
  ARSENAL_SEQUENCE.find((s) => s.kind === 'pair')?.stages ?? [];

// Campaigns + their activity in one place. Each campaign is an expandable row:
// its launch + prep-stage strip (with Run buttons) always shows; clicking it drops
// down that campaign's run activity. A trailing "Global stages" row holds runs not
// tied to a campaign (Bazooka / Glock / Sleeper). Polls ~15s via the run feed.
export function CampaignBoard() {
  const campaigns = useCampaigns();
  const runs = useArsenalRuns();
  const [openId, setOpenId] = useState<string | null>(null);

  const campaignList = campaigns.data ?? [];
  const runList = runs.data ?? [];

  // Group runs by campaign (newest-first); GLOBAL_KEY holds campaign-less runs.
  const runsByCampaign = useMemo(() => {
    const m = new Map<string, ArsenalRunDto[]>();
    for (const r of runList) {
      const key = r.campaignId ?? GLOBAL_KEY;
      const list = m.get(key);
      if (list) list.push(r);
      else m.set(key, [r]);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }
    return m;
  }, [runList]);

  const globalRuns = runsByCampaign.get(GLOBAL_KEY) ?? [];
  const toggle = (id: string) => setOpenId((p) => (p === id ? null : id));
  const synced =
    !runs.isLoading && !runs.isError
      ? timeAgo(runs.dataUpdatedAt) || 'just now'
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Campaigns</span>
          {synced ? (
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              synced {synced}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {campaigns.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : campaigns.isError ? (
          <p className="text-sm text-destructive">
            Could not load campaigns: {campaigns.error.message}
          </p>
        ) : campaignList.length === 0 && globalRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t aimed yet — click{' '}
            <span className="font-medium">AIM</span> to launch your first
            campaign.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {campaignList.map((c) => (
              <CampaignRow
                key={c.id}
                campaign={c}
                runs={runsByCampaign.get(c.id) ?? []}
                open={openId === c.id}
                onToggle={() => toggle(c.id)}
              />
            ))}
            {globalRuns.length > 0 ? (
              <GlobalRow
                runs={globalRuns}
                open={openId === GLOBAL_KEY}
                onToggle={() => toggle(GLOBAL_KEY)}
              />
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CampaignRow({
  campaign: c,
  runs,
  open,
  onToggle,
}: {
  campaign: CampaignDto;
  runs: ArsenalRunDto[];
  open: boolean;
  onToggle: () => void;
}) {
  const badge = STATUS_BADGE[c.status];
  const aim = aimStatus(c);
  const ok = runs.filter((r) => isArsenalRunOk(r.status)).length;
  const errors = runs.length - ok;
  const shown = runs.slice(0, MAX_ACTIVITY);
  const hidden = runs.length - shown.length;

  return (
    <li
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition-shadow',
        open && 'ring-1 ring-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="-m-1 flex min-w-0 flex-1 items-start gap-2 rounded-md p-1 text-left transition-colors hover:bg-muted/40"
        >
          <ChevronDown
            className={cn(
              'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium" title={c.project}>
                {c.name || c.project}
              </span>
              <Badge variant="outline" className={cn('font-medium', badge.className)}>
                {badge.label}
              </Badge>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {c.niche} · {c.target} · {c.state}, {c.country}
            </span>
            {c.status === 'FAILED' && c.deployError ? (
              <span className="mt-1 block text-xs text-destructive">
                {c.deployError}
              </span>
            ) : null}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <ActivitySummary ok={ok} errors={errors} lastAt={runs[0]?.createdAt} />
          {c.driveFolderUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={c.driveFolderUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Drive
              </a>
            </Button>
          ) : null}
          <Can permission="campaigns:write">
            <DeleteCampaignButton campaign={c} />
          </Can>
        </div>
      </div>

      {/* This campaign's sequence: AIM → Lead → Ammo (always visible). */}
      <div className="flex items-stretch gap-1.5 overflow-x-auto px-3 pb-3">
        <StageNode label="AIM" status={aim} sub={aimSub(c)} />
        {PREP_STAGES.map((stage) => {
          const st = latestRunFor(runs, stage, c.id);
          return (
            <Fragment key={stage}>
              <ChevronRight
                className={cn(
                  'size-4 shrink-0 self-center transition-colors',
                  isRunning(st)
                    ? 'animate-pulse text-emerald-500/80'
                    : 'text-muted-foreground/40',
                )}
              />
              <StageNode
                label={ARSENAL_STAGE_META[stage].label}
                status={st}
                running={isRunning(st)}
                action={
                  <Can permission="campaigns:write">
                    <RunStageButton
                      stage={stage}
                      campaignId={c.id}
                      label={st.outcome === 'failed' ? 'Retry' : 'Run now'}
                      variant="ghost"
                      size="sm"
                    />
                  </Can>
                }
              />
            </Fragment>
          );
        })}
      </div>

      {open ? (
        <ActivityList
          runs={shown}
          hidden={hidden}
          empty="No activity yet — this campaign's prep stages (Lead Satellite, Ammo Forge) will appear here once they run."
        />
      ) : null}
    </li>
  );
}

function GlobalRow({
  runs,
  open,
  onToggle,
}: {
  runs: ArsenalRunDto[];
  open: boolean;
  onToggle: () => void;
}) {
  const ok = runs.filter((r) => isArsenalRunOk(r.status)).length;
  const errors = runs.length - ok;
  const shown = runs.slice(0, MAX_ACTIVITY);
  const hidden = runs.length - shown.length;

  return (
    <li
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition-shadow',
        open && 'ring-1 ring-primary/40',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
          open && 'bg-muted/30',
        )}
      >
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
        <span className="truncate text-sm font-medium">
          Global stages · all campaigns
        </span>
        <Badge variant="secondary" className="font-normal">
          global
        </Badge>
        <span className="ml-auto">
          <ActivitySummary ok={ok} errors={errors} lastAt={runs[0]?.createdAt} />
        </span>
      </button>
      {open ? (
        <ActivityList
          runs={shown}
          hidden={hidden}
          empty="Nothing yet — Reach Bazooka / Reply Glock / Sleeper runs show here."
        />
      ) : null}
    </li>
  );
}

function ActivitySummary({
  ok,
  errors,
  lastAt,
}: {
  ok: number;
  errors: number;
  lastAt?: string;
}) {
  if (ok === 0 && errors === 0) {
    return <span className="text-xs text-muted-foreground">no activity</span>;
  }
  return (
    <span className="flex items-center gap-3 text-xs text-muted-foreground">
      {ok > 0 ? (
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          {ok}
        </span>
      ) : null}
      {errors > 0 ? (
        <span className="flex items-center gap-1 text-destructive">
          <XCircle className="size-3.5" />
          {errors}
        </span>
      ) : null}
      {lastAt ? <span className="hidden sm:inline">{timeAgo(lastAt)}</span> : null}
    </span>
  );
}

function ActivityList({
  runs,
  hidden,
  empty,
}: {
  runs: ArsenalRunDto[];
  hidden: number;
  empty: string;
}) {
  return (
    <div className="border-t bg-background/60 px-3 py-2">
      {runs.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <ActivityRow key={r.id} run={r} />
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="pt-2 text-[11px] text-muted-foreground">
              +{hidden} older activit{hidden === 1 ? 'y' : 'ies'}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ActivityRow({ run: r }: { run: ArsenalRunDto }) {
  const ok = isArsenalRunOk(r.status);
  return (
    <li className="flex items-start gap-2 py-2 first:pt-1 last:pb-1">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {ARSENAL_STAGE_META[r.stage].label}
          </span>
          <Badge
            variant="outline"
            className={cn(
              'font-medium',
              ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-destructive/30 bg-destructive/10 text-destructive',
            )}
          >
            {RUN_STATUS_LABEL[r.status]}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {r.source}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatDateTime(r.createdAt)}
          {r.detail ? ` · ${r.detail}` : ''}
        </p>
      </div>
    </li>
  );
}

function aimSub(c: CampaignDto): string {
  if (c.status === 'DEPLOYED') {
    return `launched ${timeAgo(c.deployedAt ?? c.createdAt)}`;
  }
  if (c.status === 'FAILED') return 'deploy failed';
  return 'draft';
}

function StageNode({
  label,
  status,
  sub,
  running,
  action,
}: {
  label: string;
  status: StageStatus;
  sub?: string | null;
  running?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-[7.5rem] flex-1 flex-col gap-1 rounded-md border bg-background p-2 transition-shadow',
        running && 'border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]',
      )}
    >
      <div className="flex items-center gap-1.5">
        <StatusDot outcome={status.outcome} running={running} className="shrink-0" />
        <span className="truncate text-xs font-medium">{label}</span>
      </div>
      <div
        className={cn(
          'text-[11px]',
          running
            ? 'font-medium text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground',
        )}
      >
        {running ? 'running in n8n…' : (sub ?? (status.at ? timeAgo(status.at) : 'idle'))}
      </div>
      {action ?? null}
    </div>
  );
}
