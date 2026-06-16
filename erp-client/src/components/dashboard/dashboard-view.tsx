'use client';

import { useMemo } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Activity,
  CalendarCheck,
  Crosshair,
  Filter,
  Megaphone,
  MessageSquare,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { CampaignDto, MeetingDto } from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useMeetings } from '@/hooks/use-meetings';
import { AppShell } from '@/components/shell/app-shell';
import { Can } from '@/components/auth/can';
import { LogoutButton } from '@/components/auth/logout-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { AimLaunchDialog } from '@/components/growth/aim-launch-dialog';
import { StatTile, type StatAccent } from '@/components/rean/stat-tile';
import { Funnel, type FunnelStage } from '@/components/rean/funnel';
import { MiniBarChart, type MiniBar } from '@/components/rean/mini-bar-chart';

// The R.E.A.N. dashboard — the "report" surface: funnel KPIs + live activity
// across Reach → Engage → Activate → Nurture. Every number is derived from the
// two hooks the modules already fetch (campaigns + meetings); there is no
// historical/analytics backend yet, so deltas are intentionally NOT fabricated
// and time-series panels fall back to a real "no data" state.
export function DashboardView() {
  const t = useTranslations('dashboard');
  const { data: user, isLoading, isError, error } = useMe();

  return (
    <AppShell>
      <div className="flex flex-col gap-6 font-sans">
        {isLoading ? (
          <DashboardSkeleton />
        ) : isError ? (
          <>
            <PageHeader
              title={t('header.title')}
              description={t('header.description')}
            />
            <Card className="max-w-xl">
              <CardHeader>
                <CardTitle>{t('loadError.title')}</CardTitle>
                <CardDescription>{error.message}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
                <p>{t('loadError.body')}</p>
                <LogoutButton>{t('loadError.signOut')}</LogoutButton>
              </CardContent>
            </Card>
          </>
        ) : user ? (
          <>
            <PageHeader
              title={t('header.title')}
              description={
                <>
                  {t('header.subtitle')}
                  {user.organizationName ? (
                    <>
                      {' · '}
                      <span className="text-foreground">
                        {user.organizationName}
                      </span>
                    </>
                  ) : null}
                </>
              }
              actions={
                <Can permission="campaigns:write">
                  <AimLaunchDialog />
                </Can>
              }
            />

            <Can permission="campaigns:read">
              <Overview />
            </Can>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

// ---- Derived R.E.A.N. metrics (all real counts) ----
// Reach     = every campaign we've launched (top of funnel)
// Engage    = currently-active campaigns (in-flight outreach)
// Activate  = meetings booked (a prospect engaged enough to take a call)
// Nurture   = meetings that have been analyzed (moving toward a deal)
type ReanMetrics = {
  reach: number;
  engaged: number;
  activated: number;
  nurtured: number;
};

function deriveMetrics(
  campaigns: CampaignDto[],
  meetings: MeetingDto[],
): ReanMetrics {
  return {
    reach: campaigns.length,
    engaged: campaigns.filter((c) => c.lifecycle === 'ACTIVE').length,
    activated: meetings.length,
    nurtured: meetings.filter((m) => m.analysis != null).length,
  };
}

function Overview() {
  const t = useTranslations('dashboard');
  const campaigns = useCampaigns();
  const meetings = useMeetings();

  const loading = campaigns.isLoading || meetings.isLoading;
  const campaignRows = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const meetingRows = useMemo(() => meetings.data ?? [], [meetings.data]);
  const m = useMemo(
    () => deriveMetrics(campaignRows, meetingRows),
    [campaignRows, meetingRows],
  );

  return (
    <>
      <StatRow metrics={m} loading={loading} />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <PipelineOverTimeCard meetings={meetingRows} loading={loading} />
        <LiveActivityCard
          campaigns={campaignRows}
          meetings={meetingRows}
          loading={loading}
        />
      </div>

      <ConversionFunnelCard metrics={m} loading={loading} />

      <p className="text-xs text-muted-foreground">{t('footnote')}</p>
    </>
  );
}

// ---- KPI tiles: the four R.E.A.N. stages (mockup .stats row) ----
function StatRow({
  metrics,
  loading,
}: {
  metrics: ReanMetrics;
  loading: boolean;
}) {
  const t = useTranslations('dashboard');

  const tiles: Array<{
    key: keyof ReanMetrics;
    accent: StatAccent;
    icon: React.ReactNode;
    hint: string;
  }> = [
    {
      key: 'reach',
      accent: 'sky',
      icon: <Megaphone className="size-4" />,
      hint: t('rean.reach.hint'),
    },
    {
      key: 'engaged',
      accent: 'violet',
      icon: <Crosshair className="size-4" />,
      hint: t('rean.engaged.hint'),
    },
    {
      key: 'activated',
      accent: 'amber',
      icon: <CalendarCheck className="size-4" />,
      hint: t('rean.activated.hint'),
    },
    {
      key: 'nurtured',
      accent: 'emerald',
      icon: <Users className="size-4" />,
      hint: t('rean.nurtured.hint'),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
      {tiles.map((tile) => (
        <StatTile
          key={tile.key}
          label={t(`rean.${tile.key}.label`)}
          value={
            loading ? (
              <Skeleton className="h-7 w-12" />
            ) : (
              metrics[tile.key].toLocaleString()
            )
          }
          hint={tile.hint}
          accent={tile.accent}
          icon={tile.icon}
        />
      ))}
    </div>
  );
}

// ---- Pipeline over time (real: meetings bucketed by ISO week) ----
function PipelineOverTimeCard({
  meetings,
  loading,
}: {
  meetings: MeetingDto[];
  loading: boolean;
}) {
  const t = useTranslations('dashboard');
  const format = useFormatter();

  // Bucket the last 8 weeks of activity by the week-start (Monday). We use
  // meetingDate when present, falling back to createdAt — both are real ISO
  // strings from the API. No data point is invented; weeks with no meetings
  // simply render an empty (zero-height) bar.
  const bars = useMemo<MiniBar[]>(() => {
    const WEEKS = 8;
    const now = new Date();
    const weekStart = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      const dow = (x.getDay() + 6) % 7; // Mon=0
      x.setDate(x.getDate() - dow);
      return x;
    };
    const thisWeek = weekStart(now);
    const buckets = Array.from({ length: WEEKS }, (_, i) => {
      const start = new Date(thisWeek);
      start.setDate(start.getDate() - (WEEKS - 1 - i) * 7);
      return { start, count: 0 };
    });
    for (const mt of meetings) {
      const raw = mt.meetingDate ?? mt.createdAt;
      const when = raw ? new Date(raw) : null;
      if (!when || Number.isNaN(when.getTime())) continue;
      const ws = weekStart(when).getTime();
      const bucket = buckets.find((b) => b.start.getTime() === ws);
      if (bucket) bucket.count += 1;
    }
    return buckets.map((b) => ({
      label: format.dateTime(b.start, { day: 'numeric', month: 'short' }),
      value: b.count,
      tone: 'emerald' as const,
    }));
  }, [meetings, format]);

  const anyData = bars.some((b) => b.value > 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="size-4 text-muted-foreground" />
          {t('pipeline.title')}
        </CardTitle>
        <span className="text-[11.5px] text-muted-foreground">
          {t('pipeline.range')}
        </span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : !anyData ? (
          <EmptyState
            icon={<TrendingUp />}
            title={t('pipeline.empty.title')}
            description={t('pipeline.empty.body')}
          />
        ) : (
          <>
            <MiniBarChart bars={bars} height={200} />
            <div className="mt-3 flex flex-wrap gap-3.5">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <i className="size-2 rounded-full bg-emerald-400" />
                {t('pipeline.legend')}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Live activity (real: latest campaigns + meetings, newest first) ----
type FeedItem = {
  at: number;
  tone: string;
  body: React.ReactNode;
};

function LiveActivityCard({
  campaigns,
  meetings,
  loading,
}: {
  campaigns: CampaignDto[];
  meetings: MeetingDto[];
  loading: boolean;
}) {
  const t = useTranslations('dashboard');
  const format = useFormatter();

  const items = useMemo<FeedItem[]>(() => {
    const feed: FeedItem[] = [];

    for (const c of campaigns) {
      const ts = Date.parse(c.activatedAt ?? c.createdAt);
      if (Number.isNaN(ts)) continue;
      const name = c.name?.trim() || c.project;
      feed.push({
        at: ts,
        tone: c.lifecycle === 'ACTIVE' ? 'bg-violet-400' : 'bg-sky-400',
        body: t.rich(
          c.lifecycle === 'ACTIVE'
            ? 'activity.campaignLaunched'
            : 'activity.campaignCreated',
          {
            name,
            b: (chunks) => <b className="font-semibold">{chunks}</b>,
          },
        ),
      });
    }

    for (const mt of meetings) {
      const ts = Date.parse(mt.meetingDate ?? mt.createdAt);
      if (Number.isNaN(ts)) continue;
      const company = mt.clientCompany?.trim() || t('activity.aProspect');
      const analyzed = mt.analysis != null;
      feed.push({
        at: ts,
        tone: analyzed ? 'bg-emerald-400' : 'bg-amber-400',
        body: t.rich(
          analyzed ? 'activity.meetingAnalyzed' : 'activity.meetingBooked',
          {
            company,
            b: (chunks) => <b className="font-semibold">{chunks}</b>,
          },
        ),
      });
    }

    return feed.sort((a, b) => b.at - a.at).slice(0, 6);
  }, [campaigns, meetings, t]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4 text-muted-foreground" />
          {t('activity.title')}
        </CardTitle>
        <Badge
          variant="outline"
          className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
        >
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t('activity.live')}
        </Badge>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title={t('activity.empty.title')}
            description={t('activity.empty.body')}
          />
        ) : (
          <ul className="flex flex-col">
            {items.map((it, i) => (
              <li
                key={i}
                className="flex gap-3 border-b border-border/60 py-2.5 last:border-0"
              >
                <span
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${it.tone}`}
                />
                <div className="min-w-0">
                  <div className="text-[12.5px]">{it.body}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {format.relativeTime(it.at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---- R.E.A.N. sequence conversion funnel (real, stage-to-stage) ----
function ConversionFunnelCard({
  metrics,
  loading,
}: {
  metrics: ReanMetrics;
  loading: boolean;
}) {
  const t = useTranslations('dashboard');

  const top = Math.max(1, metrics.reach);
  const pct = (n: number) => Math.round((n / top) * 1000) / 10;
  const stages: FunnelStage[] = [
    {
      label: t('rean.reach.label'),
      percent: metrics.reach === 0 ? 0 : 100,
      fill: `${metrics.reach === 0 ? 0 : 100}%`,
      value: metrics.reach.toLocaleString(),
      tone: 'sky',
    },
    {
      label: t('rean.engaged.label'),
      percent: pct(metrics.engaged),
      fill: `${pct(metrics.engaged)}%`,
      value: metrics.engaged.toLocaleString(),
      tone: 'violet',
    },
    {
      label: t('rean.activated.label'),
      percent: pct(metrics.activated),
      fill: `${pct(metrics.activated)}%`,
      value: metrics.activated.toLocaleString(),
      tone: 'amber',
    },
    {
      label: t('rean.nurtured.label'),
      percent: pct(metrics.nurtured),
      fill: `${pct(metrics.nurtured)}%`,
      value: metrics.nurtured.toLocaleString(),
      tone: 'emerald',
    },
  ];

  const anyData = metrics.reach > 0 || metrics.activated > 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Filter className="size-4 text-muted-foreground" />
          {t('funnel.title')}
        </CardTitle>
        <span className="text-[11.5px] text-muted-foreground">
          {t('funnel.subtitle')}
        </span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[140px] w-full" />
        ) : !anyData ? (
          <EmptyState
            icon={<Filter />}
            title={t('funnel.empty.title')}
            description={t('funnel.empty.body')}
          />
        ) : (
          <Funnel stages={stages} />
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-[300px] w-full rounded-lg" />
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </div>
      <Skeleton className="h-[220px] w-full rounded-lg" />
    </>
  );
}
