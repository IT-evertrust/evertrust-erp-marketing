'use client';

import { useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';

import { EngineActivityFeed } from '../components/activity-feed';
import { EngineWheel } from '../components/engine-wheel';
import { KpiGrid } from '../components/kpi-grid';
import { ReanFunnel } from '../components/rean-funnel';
import { ENGINE_MODULES, activityMatchesModule } from '../engine-modules';
import { useOverview } from '../hooks/use-overview';

// The Overview body — a faithful port of the Saloot demo's report view. The
// GrowthTopbar is still the single page header (title "Overview"). Two rows:
//   A) the Engine Modules wheel + the live Engine Activity feed
//   B) the R.E.A.N funnel + the 6-KPI grid
// All numbers/feed come from the live `useOverview` data; the wheel is the static
// module map, and hovering a module filters the activity feed to its runs.
export function OverviewUI() {
  const overview = useOverview();
  const tOverview = useTranslations('overview');

  const [activeModuleKey, setActiveModuleKey] = useState<string | null>(null);

  const activeModule = useMemo(
    () =>
      activeModuleKey
        ? (ENGINE_MODULES.find((m) => m.key === activeModuleKey) ?? null)
        : null,
    [activeModuleKey],
  );

  // When a module is hovered/pinned on the wheel, narrow the feed to its runs.
  const feedActivity = useMemo(() => {
    if (!activeModule) return overview.activity;
    return overview.activity.filter((item) =>
      activityMatchesModule(item.source, activeModule),
    );
  }, [overview.activity, activeModule]);

  return (
    <main className="min-h-[calc(100vh-80px)] bg-[#eef0f3] px-6 py-5 text-[#15171c] duration-300 animate-in fade-in">
      {overview.isError ? (
        <div className="mb-4 rounded-[10px] border border-[#e4e7eb] bg-white px-4 py-3 text-[12.5px] font-bold text-[#5b626d]">
          {tOverview('loadError')}
        </div>
      ) : null}

      {/* Row A — Engine Modules wheel + Engine Activity feed */}
      <section className="grid grid-cols-1 gap-4 xl:h-[520px] xl:grid-cols-[1.35fr_1fr]">
        <EngineWheel onActiveChange={setActiveModuleKey} />
        <EngineActivityFeed
          activity={feedActivity}
          alerts={activeModule ? [] : overview.alerts}
          emptyHint={activeModule ? 'No recent runs for this module.' : undefined}
        />
      </section>

      {/* Row B — R.E.A.N funnel + KPI grid */}
      <section className="mt-4 grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[1.6fr_1fr]">
        <ReanFunnel stages={overview.funnel} />
        <KpiGrid kpis={overview.kpis} />
      </section>
    </main>
  );
}
