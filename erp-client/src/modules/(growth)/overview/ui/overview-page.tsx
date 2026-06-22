'use client';

import { EngineActivityFeed } from '../components/activity-feed';
import { KpiGrid } from '../components/kpi-grid';
import { ReanFunnel } from '../components/rean-funnel';
import { useOverview } from '../hooks/use-overview';

// The page header (icon + "Overview" + subtitle) is rendered once by the shared
// GrowthTopbar, exactly like Reach/Engage/Activate — this view renders only its body.
// (It used to render its own duplicate header, which stacked on top of the topbar's
// when the page was empty.)
export function OverviewUI() {
  const overview = useOverview();

  return (
    <main
      className="min-h-[calc(100vh-64px)] bg-[#eef0f3] px-6 py-5 text-[#15171c] duration-300 animate-in fade-in"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      {overview.isError ? (
        <div className="mb-4 rounded-[10px] border border-[#d6dade] bg-white px-4 py-3 text-[12.5px] font-bold text-[#5b626d]">
          Could not load live dashboard data. Showing fallback cockpit metrics.
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
