'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChevronRight,
  Crosshair,
  Loader2,
  MessagesSquare,
  Moon,
  Radar,
  RefreshCw,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  STAGE_PRIMARY_METRIC,
  type ArsenalStage,
  type MarketingReportPeriod,
  type MarketingStageReportDto,
} from '@evertrust/shared';
import {
  useArsenalBackfill,
  useClearArsenalRuns,
  useMarketingReport,
} from '@/hooks/use-arsenal';
import { useCampaigns } from '@/hooks/use-campaigns';
import { Can } from '@/components/auth/can';
import { ConfirmButton } from '@/components/common/confirm-button';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Sparkline } from './sparkline';

// Sentinel for the "all campaigns" option (Select can't use an empty value).
const ALL = 'all';

const PERIODS: MarketingReportPeriod[] = ['day', 'week', 'month'];

const STAGE_ICON: Record<ArsenalStage, LucideIcon> = {
  LEAD_SATELLITE: Radar,
  AMMO_FORGE: Crosshair,
  REACH_BAZOOKA: Send,
  REPLY_GLOCK: MessagesSquare,
  SLEEPER_GRENADE: Moon,
};

// The RAG draft funnel steps, in order; labels come from report.ragSteps.*.
const RAG_STEPS = ['unsure', 'drafted', 'approved', 'sent', 'replied'] as const;

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

// Marketing → "Report" tab (mockup design): the Growth-Engine sequence as a
// Day/Week/Month report. Funnel + Per-stage are REAL (live from arsenal_runs); the
// RAG draft funnel, draft outcomes/timing, and tender attribution render as honest
// "awaiting" placeholders — no fabricated numbers — and light up once those sources
// exist (the RAG Agent workflow's counts; a campaign↔tender link).
export function MarketingReport() {
  const t = useTranslations('marketing');
  const [period, setPeriod] = useState<MarketingReportPeriod>('week');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const query = useMarketingReport(period, campaignId);
  const data = query.data;
  const campaigns = useCampaigns();
  const campaignList = campaigns.data ?? [];
  const backfill = useArsenalBackfill();
  const clearRuns = useClearArsenalRuns();

  return (
    <div className="flex flex-col gap-4">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                period === p
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`report.period.${p}`)}
            </button>
          ))}
        </div>
        <Select
          value={campaignId ?? ALL}
          onValueChange={(v) => setCampaignId(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('report.allCampaigns')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('report.allCampaigns')}</SelectItem>
            {campaignList.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name || c.project}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {t(`report.window.${period}`)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Can permission="campaigns:write">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => backfill.mutate()}
              disabled={backfill.isPending}
              title={t('report.syncTitle')}
            >
              {backfill.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {backfill.isPending ? t('report.syncing') : t('report.syncFromN8n')}
            </Button>
            <ConfirmButton
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <Trash2 />
                  {t('report.clearRuns')}
                </Button>
              }
              title={t('report.clearTitle')}
              description={t('report.clearDescription')}
              confirmLabel={t('report.clearRuns')}
              pending={clearRuns.isPending}
              onConfirm={() => clearRuns.mutate()}
            />
          </Can>
        </div>
      </div>

      {query.isError ? (
        <p className="text-sm text-destructive">
          {t('report.loadError', { message: query.error.message })}
        </p>
      ) : null}

      {backfill.isError ? (
        <p className="text-sm text-destructive">
          {t('report.syncError', { message: backfill.error.message })}
        </p>
      ) : backfill.data ? (
        <p className="text-xs text-muted-foreground">
          {backfill.data.configured
            ? t('report.synced', {
                count: backfill.data.imported,
                scanned: backfill.data.scanned,
              })
            : t('report.syncNotConfigured')}
        </p>
      ) : null}

      {/* Funnel — REAL (arsenal_runs metrics) */}
      <ReportSection title={t('report.section.funnel')}>
        {query.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FunnelStep label={t('report.funnel.leadsFound')} value={data?.funnel.leadsFound ?? null} />
            <FunnelStep label={t('report.funnel.emailsSent')} value={data?.funnel.emailsSent ?? null} />
            <FunnelStep label={t('report.funnel.replies')} value={data?.funnel.repliesHandled ?? null} />
            <FunnelStep label={t('report.funnel.meetings')} value={data?.funnel.meetingsBooked ?? null} />
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t.rich('report.funnel.hint', {
            code: (chunks) => <code className="mx-0.5 rounded bg-muted px-1">{chunks}</code>,
          })}
        </p>
      </ReportSection>

      {/* RAG draft funnel — awaiting (RAG Agent workflow not yet reporting) */}
      <ReportSection title={t('report.section.ragFunnel')}>
        <div className="flex items-stretch gap-1.5 overflow-x-auto">
          {RAG_STEPS.map((s, i) => (
            <Fragment key={s}>
              {i > 0 ? (
                <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground/40" />
              ) : null}
              <div className="min-w-[5.5rem] flex-1 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-2.5 text-center">
                <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                  —
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t(`report.ragSteps.${s}`)}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('report.ragHint')}
        </p>
      </ReportSection>

      {/* Draft outcomes & response timing — awaiting */}
      <ReportSection title={t('report.section.draftOutcomes')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <KvBox
            title={t('report.outcomes.title')}
            rows={[
              t('report.outcomes.rowSent'),
              t('report.outcomes.rowEditedSent'),
              t('report.outcomes.rowDiscarded'),
              t('report.outcomes.rowApprovalRate'),
              t('report.outcomes.rowAvgEdits'),
            ]}
          />
          <KvBox
            title={t('report.timing.title')}
            rows={[
              t('report.timing.rowUnsureReady'),
              t('report.timing.rowDraftSent'),
              t('report.timing.rowStale'),
              t('report.timing.rowFastest'),
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('report.draftOutcomesHint')}
        </p>
      </ReportSection>

      {/* Tender attribution — awaiting (no campaign↔tender link yet) */}
      <ReportSection title={t('report.section.tenderAttribution')}>
        <p className="text-sm text-muted-foreground">
          {t('report.tenderAttributionText')}
        </p>
      </ReportSection>

      {/* Per stage · this period — REAL */}
      <ReportSection title={t('report.section.perStage')}>
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : data ? (
          <div className="flex flex-col">
            {data.stages.map((s) => (
              <StageLane key={s.stage} stage={s} />
            ))}
          </div>
        ) : null}
      </ReportSection>
    </div>
  );
}

// A panel matching the mockup's `.sec` (bordered card + small uppercase header).
function ReportSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {title}
      </p>
      {children}
    </div>
  );
}

// Two-column key/value box (mockup `.sgb`), values "—" until tracked.
function KvBox({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3.5">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      {rows.map((r) => (
        <div
          key={r}
          className="flex items-center justify-between border-b border-dashed border-border py-1 text-sm last:border-b-0"
        >
          <span className="text-muted-foreground">{r}</span>
          <span className="font-semibold text-muted-foreground/50">—</span>
        </div>
      ))}
    </div>
  );
}

function FunnelStep({ label, value }: { label: string; value: number | null }) {
  const t = useTranslations('marketing');
  const empty = value === null;
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        empty
          ? 'border-dashed border-amber-500/50 bg-amber-500/5'
          : 'border-sky-500/30 bg-sky-500/10',
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          empty
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-sky-700 dark:text-sky-300',
        )}
      >
        {empty ? '—' : value.toLocaleString()}
      </div>
      {empty ? (
        <div className="text-[10px] text-amber-600 dark:text-amber-400">
          {t('report.funnel.awaiting')}
        </div>
      ) : null}
    </div>
  );
}

function StageLane({ stage: s }: { stage: MarketingStageReportDto }) {
  const t = useTranslations('marketing');
  const Icon = STAGE_ICON[s.stage] ?? Crosshair;
  const hasError = s.errors > 0;
  const metricKey = STAGE_PRIMARY_METRIC[s.stage];
  const metricVal = s.metrics[metricKey];
  const metricLabel = t(`metric.${metricKey}`);

  return (
    <div className="flex items-center gap-4 overflow-x-auto border-t py-3 first:border-t-0">
      <div className="flex w-44 shrink-0 items-center gap-2">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            hasError
              ? 'bg-destructive'
              : s.runs > 0
                ? 'bg-emerald-500'
                : 'bg-muted-foreground/40',
          )}
        />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span
          className="truncate text-sm font-medium"
          title={t(`stageWhat.${s.stage}`)}
        >
          {t(`stage.${s.stage}`)}
        </span>
      </div>

      <div className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">
        {t('report.stageRuns', { runs: s.runs, pct: pct(s.successRate) })}
      </div>

      {hasError ? (
        <Badge
          variant="outline"
          className="shrink-0 border-destructive/30 bg-destructive/10 text-[10px] text-destructive"
        >
          {t('report.stageErrors', { count: s.errors })}
        </Badge>
      ) : null}

      <div className="min-w-0 flex-1 text-xs">
        {metricLabel}{' '}
        {metricVal === undefined ? (
          <span className="text-amber-600 dark:text-amber-400">{t('report.metricAwaiting')}</span>
        ) : (
          <span className="font-semibold text-sky-700 dark:text-sky-300 tabular-nums">
            {metricVal.toLocaleString()}
          </span>
        )}
      </div>

      <Sparkline values={s.trend} className="w-28 shrink-0" />
    </div>
  );
}
