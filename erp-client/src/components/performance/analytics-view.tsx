'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, PieChart } from 'lucide-react';
import { useOverview } from '@/hooks/use-performance';
import { EmptyState } from '@/components/common/empty-state';
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
//
// Restyled to Kobe's minimalist GrowthShell language: a `<main>` masthead
// (title + uppercase eyebrow) over token-based card surfaces. Colours are theme
// tokens only (dark-mode safe); all i18n keys are preserved.

const RANGES = ['last30', 'quarter', 'ytd'] as const;
type Range = (typeof RANGES)[number];

// A token-based card surface matching Kobe's GrowthCard look (rounded-[10px],
// sidebar-border, bg-card, bold title row). Kept local + theme-token-only so the
// surface is dark-mode safe.
function AnalyticsCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[10px] border border-sidebar-border bg-card">
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-[15px]">
        <h2 className="text-[13.5px] font-bold leading-none text-foreground">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

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
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-sidebar-border pb-5">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-none tracking-[-0.01em] text-foreground">
            {t('title')}
          </h1>
          <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {t('description')}
          </div>
        </div>

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
      </div>

      {overview.isError ? (
        <div className="mb-4 rounded-[10px] border border-sidebar-border bg-card px-4 py-3 text-[12.5px] font-medium text-destructive">
          {t('loadError', { message: overview.error.message })}
        </div>
      ) : null}

      {/* Replies by week (MiniBarChart) + Channel mix (ChannelMix). No data
          source yet → each renders a neutral empty state, no fabricated bars. */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <AnalyticsCard title={t('repliesByWeek.title')}>
          {replyBars.length > 0 ? (
            <MiniBarChart bars={replyBars} />
          ) : (
            <EmptyState
              icon={<BarChart3 />}
              title={t('repliesByWeek.title')}
              description={t('repliesByWeek.noData')}
            />
          )}
        </AnalyticsCard>
        <AnalyticsCard title={t('channelMix.title')}>
          {channelSegments.length > 0 ? (
            <ChannelMix segments={channelSegments} />
          ) : (
            <EmptyState
              icon={<PieChart />}
              title={t('channelMix.title')}
              description={t('channelMix.noData')}
            />
          )}
        </AnalyticsCard>
      </div>

      {/* Four KPI tiles. None are exposed by the performance API yet, so each
          shows a neutral "—" with an "awaiting a data source" hint. */}
      <div className="mt-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
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
      <section className="mt-6 flex flex-col gap-4 border-t border-sidebar-border pt-6">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {t('scorecards.title')}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t('scorecards.description')}
          </p>
        </div>
        <PerformanceView hideHeader />
      </section>
    </main>
  );
}
