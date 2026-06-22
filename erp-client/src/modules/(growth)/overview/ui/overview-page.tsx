'use client';

import { LayoutGrid } from 'lucide-react';

import { GrowthShell } from '@/modules/(growth)/shell';
import { LiveDot } from '@/modules/(growth)/shared';

import { EngineActivityFeed } from '../components/activity-feed';
import { KpiGrid } from '../components/kpi-grid';
import { ReanFunnel } from '../components/rean-funnel';
import { useOverview } from '../hooks/use-overview';

export function OverviewUI() {
  const overview = useOverview();

  return (
      <main
        className="min-h-[calc(100vh-64px)] bg-[#eef0f3] px-6 py-5 text-[#15171c]"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        <div className="mb-5 flex items-center justify-between border-b border-[#e4e7eb] pb-5">
          <div className="flex items-center gap-3">
            <LayoutGrid className="h-7 w-7 stroke-[2]" />

            <div>
              <h1 className="text-[30px] font-bold leading-none tracking-[-0.02em]">
                Overview
              </h1>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#959ca7]">
                Report · All phases · Last 30 days
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-[#d6dade] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5b626d] md:flex">
            <LiveDot />
            Engine live
          </div>
        </div>

        {overview.isError ? (
          <div className="mb-4 rounded-[10px] border border-[#d6dade] bg-white px-4 py-3 text-[12.5px] font-bold text-[#5b626d]">
            Could not load live dashboard data. Showing fallback cockpit metrics.
          </div>
        ) : null}

        <KpiGrid kpis={overview.kpis} />

        <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
          <ReanFunnel stages={overview.funnel} />
          <EngineActivityFeed activity={overview.activity} />
        </section>
      </main>
  );
}
