'use client';

import { Fragment, useState, type ReactNode } from 'react';
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
  ARSENAL_METRIC_LABEL,
  ARSENAL_STAGE_META,
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

const PERIODS: { value: MarketingReportPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const WINDOW_LABEL: Record<MarketingReportPeriod, string> = {
  day: 'Last 24 hours',
  week: 'Last 7 days',
  month: 'Last 30 days',
};

const STAGE_ICON: Record<ArsenalStage, LucideIcon> = {
  LEAD_SATELLITE: Radar,
  AMMO_FORGE: Crosshair,
  REACH_BAZOOKA: Send,
  REPLY_GLOCK: MessagesSquare,
  SLEEPER_GRENADE: Moon,
};

const RAG_STEPS = ['Unsure', 'Drafted', 'Approved', 'Sent', 'Replied'];

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

// Marketing → "Report" tab (mockup design): the Growth-Engine sequence as a
// Day/Week/Month report. Funnel + Per-stage are REAL (live from arsenal_runs); the
// RAG draft funnel, draft outcomes/timing, and tender attribution render as honest
// "awaiting" placeholders — no fabricated numbers — and light up once those sources
// exist (the RAG Agent workflow's counts; a campaign↔tender link).
export function MarketingReport() {
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
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                period === p.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Select
          value={campaignId ?? ALL}
          onValueChange={(v) => setCampaignId(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All campaigns</SelectItem>
            {campaignList.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name || c.project}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {WINDOW_LABEL[period]}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Can permission="campaigns:write">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => backfill.mutate()}
              disabled={backfill.isPending}
              title="Import recent runs + counts from n8n's execution history"
            >
              {backfill.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {backfill.isPending ? 'Syncing…' : 'Sync from n8n'}
            </Button>
            <ConfirmButton
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <Trash2 />
                  Clear runs
                </Button>
              }
              title="Clear all run activity?"
              description="Deletes every arsenal run (Live activity + this report). Test-data reset — this can't be undone."
              confirmLabel="Clear runs"
              pending={clearRuns.isPending}
              onConfirm={() => clearRuns.mutate()}
            />
          </Can>
        </div>
      </div>

      {query.isError ? (
        <p className="text-sm text-destructive">
          Could not load the report: {query.error.message}
        </p>
      ) : null}

      {backfill.isError ? (
        <p className="text-sm text-destructive">
          Sync failed: {backfill.error.message}
        </p>
      ) : backfill.data ? (
        <p className="text-xs text-muted-foreground">
          {backfill.data.configured
            ? `Synced from n8n — imported ${backfill.data.imported} run${backfill.data.imported === 1 ? '' : 's'} (scanned ${backfill.data.scanned}).`
            : 'n8n API not configured — set N8N_API_URL / N8N_API_KEY to sync.'}
        </p>
      ) : null}

      {/* Funnel — REAL (arsenal_runs metrics) */}
      <ReportSection title="Funnel">
        {query.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FunnelStep label="Leads found" value={data?.funnel.leadsFound ?? null} />
            <FunnelStep label="Emails sent" value={data?.funnel.emailsSent ?? null} />
            <FunnelStep label="Replies" value={data?.funnel.repliesHandled ?? null} />
            <FunnelStep label="Meetings" value={data?.funnel.meetingsBooked ?? null} />
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Amber = awaiting n8n. Each lights up once the stage reports a{' '}
          <code className="mx-0.5 rounded bg-muted px-1">metrics</code> count via the
          run callback.
        </p>
      </ReportSection>

      {/* RAG draft funnel — awaiting (RAG Agent workflow not yet reporting) */}
      <ReportSection title="RAG draft funnel">
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
                  {s}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Lights up once the RAG Agent workflow reports drafted / approved / sent
          counts.
        </p>
      </ReportSection>

      {/* Draft outcomes & response timing — awaiting */}
      <ReportSection title="Draft outcomes & response timing">
        <div className="grid gap-3 sm:grid-cols-2">
          <KvBox
            title="Outcomes (30d)"
            rows={['Sent', 'Edited → sent', 'Discarded', 'Approval rate', 'Avg edits / draft']}
          />
          <KvBox
            title="Response timing"
            rows={['Unsure → draft ready', 'Draft → sent', 'Stale drafts (>24h)', 'Fastest send']}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Populated once RAG-draft outcomes are tracked end-to-end.
        </p>
      </ReportSection>

      {/* Tender attribution — awaiting (no campaign↔tender link yet) */}
      <ReportSection title="Tender attribution — what this activity is advancing">
        <p className="text-sm text-muted-foreground">
          No campaign → tender links yet. Once outbound leads graduate into tenders,
          this shows which tenders each campaign is advancing and their € value.
        </p>
      </ReportSection>

      {/* Per stage · this period — REAL */}
      <ReportSection title="Per stage · this period">
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
          awaiting n8n
        </div>
      ) : null}
    </div>
  );
}

function StageLane({ stage: s }: { stage: MarketingStageReportDto }) {
  const Icon = STAGE_ICON[s.stage] ?? Crosshair;
  const hasError = s.errors > 0;
  const metricKey = STAGE_PRIMARY_METRIC[s.stage];
  const metricVal = s.metrics[metricKey];
  const metricLabel = ARSENAL_METRIC_LABEL[metricKey];

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
          title={ARSENAL_STAGE_META[s.stage].what}
        >
          {ARSENAL_STAGE_META[s.stage].label}
        </span>
      </div>

      <div className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">
        {s.runs} runs · {pct(s.successRate)} ok
      </div>

      {hasError ? (
        <Badge
          variant="outline"
          className="shrink-0 border-destructive/30 bg-destructive/10 text-[10px] text-destructive"
        >
          {s.errors} error{s.errors === 1 ? '' : 's'}
        </Badge>
      ) : null}

      <div className="min-w-0 flex-1 text-xs">
        {metricLabel}{' '}
        {metricVal === undefined ? (
          <span className="text-amber-600 dark:text-amber-400">— awaiting n8n</span>
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
