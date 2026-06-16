'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, PieChart } from 'lucide-react';
import { useOverview } from '@/hooks/use-performance';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatTile } from '@/components/rean/stat-tile';
import { MiniBarChart, type MiniBar } from '@/components/rean/mini-bar-chart';
import { ChannelMix, type ChannelSegment } from '@/components/rean/channel-mix';
import { PerformanceView } from './performance-view';

// Analytics (mockup data-page="analytics", ~lines 492–527): cross-stage
// performance + channel breakdowns. The mockup's analytics widgets — "Replies by
// week", "Channel mix", and the reply/meeting/win/deal-size tiles — have NO
// backing API in the performance hooks, so they render honest neutral/zero
// states (never fabricated numbers) and will light up once those sources exist.
// The real, wired surface — team scorecards + the executive cockpit, fed by
// useScorecards/useOverview — is preserved below via <PerformanceView />.

const RANGES = ['last30', 'quarter', 'ytd'] as const;
type Range = (typeof RANGES)[number];

export function AnalyticsView() {
  const t = useTranslations('analytics');
  // Touch the live performance feed so the page errors honestly if it can't be
  // reached; the wired team data lives in <PerformanceView /> below.
  const overview = useOverview('WEEKLY');
  const [range, setRange] = useState<Range>('last30');

  // No performance-hook source backs these two charts yet, so the data slots are
  // empty and each card falls back to its honest empty state. They render the
  // real kit charts the moment a source populates them — no fabricated values.
  const replyBars: MiniBar[] = [];
  const channelSegments: ChannelSegment[] = [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="w-[170px]" aria-label={t('period.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`period.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {overview.isError ? (
        <p className="text-sm text-destructive">
          {t('loadError', { message: overview.error.message })}
        </p>
      ) : null}

      {/* Replies by week (MiniBarChart) + Channel mix (ChannelMix). No data
          source yet → each renders a neutral empty state, no fabricated bars. */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('repliesByWeek.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {replyBars.length > 0 ? (
              <MiniBarChart bars={replyBars} />
            ) : (
              <EmptyState
                icon={<BarChart3 />}
                title={t('repliesByWeek.title')}
                description={t('repliesByWeek.noData')}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('channelMix.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {channelSegments.length > 0 ? (
              <ChannelMix segments={channelSegments} />
            ) : (
              <EmptyState
                icon={<PieChart />}
                title={t('channelMix.title')}
                description={t('channelMix.noData')}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Four KPI tiles. None are exposed by the performance API yet, so each
          shows a neutral "—" with an "awaiting a data source" hint. */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatTile
          label={t('tiles.avgReplyRate')}
          value="—"
          hint={t('tiles.noSource')}
        />
        <StatTile
          label={t('tiles.meetingRate')}
          value="—"
          hint={t('tiles.noSource')}
        />
        <StatTile
          label={t('tiles.winRate')}
          value="—"
          hint={t('tiles.noSource')}
        />
        <StatTile
          label={t('tiles.avgDealSize')}
          value="—"
          hint={t('tiles.noSource')}
        />
      </div>

      {/* Preserve the existing, wired analytics surface: team scorecards +
          executive cockpit (useScorecards / useOverview). */}
      <section className="flex flex-col gap-4 border-t pt-6">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('scorecards.title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('scorecards.description')}
          </p>
        </div>
        <PerformanceView hideHeader />
      </section>
    </div>
  );
}
