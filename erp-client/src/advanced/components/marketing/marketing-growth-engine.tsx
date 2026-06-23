'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import {
  ARSENAL_STAGE_META,
  STAGE_PRIMARY_METRIC,
  type ArsenalStage,
} from '@evertrust/shared';
import {
  useArsenalBackfill,
  useArsenalRuns,
  useArsenalSettings,
  useMarketingReport,
} from '@/hooks/use-arsenal';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useNiches } from '@/hooks/use-niches';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { isRunning, latestRunFor, timeAgo } from '@/lib/arsenal-sequence';
import { RunStageButton } from '@/components/growth/run-stage-button';
import { StatusDot } from '@/components/growth/status-dot';

// The arsenal pipeline in launch order, each stage tagged with its AIM-sequence
// codename (mockup parity — KEEP the codenames). `code`/`phase` head each card;
// `stage` maps 1:1 to the real ArsenalStage the run feed + report key off.
const PIPELINE: { stage: ArsenalStage; code: string; phaseKey: string }[] = [
  { stage: 'LEAD_SATELLITE', code: '01', phaseKey: 'target' },
  { stage: 'AMMO_FORGE', code: '02', phaseKey: 'arm' },
  { stage: 'REACH_BAZOOKA', code: '03', phaseKey: 'fire' },
  { stage: 'REPLY_GLOCK', code: '04', phaseKey: 'catch' },
  { stage: 'SLEEPER_GRENADE', code: '05', phaseKey: 'revive' },
];

// Outcome-first Growth-Engine view (approved mockup): a real funnel hero on top,
// the codenamed arsenal pipeline below, then top niches by industry. Every number
// is REAL — the weekly marketing report's funnel, arsenal_runs, campaigns, niche
// prospect counts; absent values render "—" rather than a fabricated zero.
export function MarketingGrowthEngine() {
  const t = useTranslations('growth');
  const report = useMarketingReport('week', null);
  const runs = useArsenalRuns();
  const settings = useArsenalSettings();
  const campaigns = useCampaigns();
  const niches = useNiches();
  const backfill = useArsenalBackfill();

  const runList = runs.data ?? [];
  const activeCount = (campaigns.data ?? []).filter(
    (c) => c.lifecycle === 'ACTIVE',
  ).length;
  const nextSend = settings.data?.bazookaDailyAt ?? null;

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
      {/* Header row: title + live status chips + Sync */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold">{t('engine.title')}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground sm:ml-auto">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot outcome="ok" running />
            {t('engine.status.active', { count: activeCount })}
          </span>
          <span className="text-muted-foreground/40" aria-hidden="true">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {t('engine.status.nextSend')}{' '}
            <b className="text-foreground">
              {nextSend ?? t('engine.status.manual')}
            </b>
          </span>
          <Can permission="campaigns:write">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => backfill.mutate()}
              disabled={backfill.isPending}
              title={t('engine.syncHint')}
            >
              {backfill.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {backfill.isPending ? t('engine.syncing') : t('engine.sync')}
            </Button>
          </Can>
        </div>
      </div>

      {/* Funnel hero — the real weekly outcome funnel */}
      <FunnelHero
        loading={report.isLoading}
        funnel={report.data?.funnel ?? null}
        t={t}
      />

      {/* Codenamed arsenal pipeline — compact */}
      <div>
        <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {t('engine.pipeline.heading')}
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
                  'flex flex-col gap-1 rounded-xl border bg-card p-3',
                  running &&
                    'border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    {p.code} · {t(`engine.phase.${p.phaseKey}`)}
                  </span>
                  <StatusDot outcome={st.outcome} running={running} />
                </div>
                <div className="text-sm font-semibold leading-tight">
                  {ARSENAL_STAGE_META[p.stage].label}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {running
                    ? t('engine.pipeline.running')
                    : st.at
                      ? t('engine.pipeline.last', { ago: timeAgo(st.at) })
                      : t('engine.pipeline.noRuns')}
                </div>
                <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
                  <div className="text-xl font-bold tabular-nums">
                    {report.isLoading ? (
                      <Skeleton className="h-6 w-7" />
                    ) : c === null ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      c
                    )}
                  </div>
                  <Can permission="campaigns:write">
                    <RunStageButton
                      stage={p.stage}
                      label={t('engine.pipeline.run')}
                      variant="outline"
                      size="sm"
                    />
                  </Can>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top niches by industry */}
      <TopNiches loading={niches.isLoading} niches={niches.data ?? []} t={t} />
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations>;

// The funnel hero: four outcome nodes (leads → emails → replies → meetings) with
// the conversion rate shown between each pair. A null metric (= "awaiting n8n")
// renders "—"; conversions guard divide-by-zero and only show when both ends are
// real numbers.
function FunnelHero({
  loading,
  funnel,
  t,
}: {
  loading: boolean;
  funnel: {
    leadsFound: number | null;
    emailsSent: number | null;
    repliesHandled: number | null;
    meetingsBooked: number | null;
  } | null;
  t: Translate;
}) {
  const nodes = [
    { key: 'leads', value: funnel?.leadsFound ?? null },
    { key: 'emails', value: funnel?.emailsSent ?? null },
    { key: 'replies', value: funnel?.repliesHandled ?? null },
    { key: 'meetings', value: funnel?.meetingsBooked ?? null },
  ] as const;

  // Conversion between two stages — only when both are real numbers and the
  // numerator's base is > 0 (no divide-by-zero, no fabricated percentage).
  const conv = (from: number | null, to: number | null): string => {
    if (from === null || to === null || from <= 0) return '—';
    return `${Math.round((to / from) * 100)}%`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('engine.funnel.title')}</CardTitle>
        <CardDescription>{t('engine.funnel.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {nodes.map((n) => (
              <Skeleton key={n.key} className="h-[88px] w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {nodes.map((n, i) => (
              <div key={n.key} className="flex items-stretch gap-3 lg:flex-1">
                <div className="flex flex-1 flex-col justify-center rounded-xl border bg-muted/20 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {t(`engine.funnel.${n.key}`)}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {n.value === null ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      n.value.toLocaleString()
                    )}
                  </div>
                </div>
                {i < nodes.length - 1 && (
                  <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 text-muted-foreground">
                    <ArrowRight className="size-4 lg:rotate-0" />
                    <span className="text-[11px] font-medium tabular-nums">
                      {conv(n.value, nodes[i + 1]?.value ?? null)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Top niches by industry: the org's niches with the most live prospects, each a
// proportional bar. Counts are REAL (NicheListItemDto.prospectCount); only niches
// with prospects show, capped at the top 5. Empty when none have prospects yet.
function TopNiches({
  loading,
  niches,
  t,
}: {
  loading: boolean;
  niches: { name: string; prospectCount: number; industryName: string | null }[];
  t: Translate;
}) {
  const top = [...niches]
    .filter((n) => n.prospectCount > 0)
    .sort((a, b) => b.prospectCount - a.prospectCount)
    .slice(0, 5);
  const max = Math.max(1, ...top.map((n) => n.prospectCount));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('engine.niches.title')}</CardTitle>
        <CardDescription>{t('engine.niches.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : top.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t('engine.niches.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {top.map((n) => (
              <div key={`${n.industryName ?? ''}-${n.name}`} className="flex items-center gap-3">
                <Badge variant="outline" className="shrink-0 font-normal">
                  {n.industryName ?? t('engine.niches.unassigned')}
                </Badge>
                <span className="w-28 shrink-0 truncate text-sm" title={n.name}>
                  {n.name}
                </span>
                <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted/40">
                  <div
                    className="h-full rounded-md bg-sky-500/70 transition-all"
                    style={{
                      width: `${Math.max(6, (n.prospectCount / max) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {n.prospectCount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
