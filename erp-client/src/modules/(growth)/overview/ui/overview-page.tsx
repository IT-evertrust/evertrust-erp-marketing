'use client';

import { useTranslations } from 'next-intl';

import { LiveDot } from '@/modules/(growth)/shared';

import { EngineActivityFeed } from '../components/activity-feed';
import { KpiGrid } from '../components/kpi-grid';
import { ReanFunnel } from '../components/rean-funnel';
import { useOverview } from '../hooks/use-overview';

// The Overview body renders NO masthead — the GrowthTopbar is the single page
// header (title "Overview" + subtitle), so there's no Dashboard/Overview
// duplicate. Only a slim ENGINE LIVE status pill rides at the top of the content.
// Font is inherited (Geist) — no inline override.
export function OverviewUI() {
  const overview = useOverview();
  const t = useTranslations('nav');
  const tOverview = useTranslations('overview');

  return (
    <main className="min-h-[calc(100vh-80px)] bg-background px-6 py-5 text-foreground duration-300 animate-in fade-in">
      <div className="mb-5 flex items-center justify-end">
        <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground md:flex">
          <LiveDot />
          {t('engineLive')}
        </div>
      </div>

      {overview.isError ? (
        <div className="mb-4 rounded-[10px] border border-border bg-card px-4 py-3 text-[12.5px] font-bold text-muted-foreground">
          {tOverview('loadError')}
        </div>
      ) : null}

      <KpiGrid kpis={overview.kpis} />

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <ReanFunnel stages={overview.funnel} />
        <EngineActivityFeed activity={overview.activity} alerts={overview.alerts} />
      </section>
    </main>
  );
}
