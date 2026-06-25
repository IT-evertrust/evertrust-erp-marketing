'use client';

import { useTranslations } from 'next-intl';

import type { OverviewKpi } from '../types';

type KpiCardProps = {
  kpi: OverviewKpi;
  iconIndex: number;
};

// One KPI tile — a faithful port of the Saloot demo's `.kpi` card: label, big
// value, ▲ delta, and a sparkline. Light grayscale palette; copy stays i18n.
export function KpiCard({ kpi, iconIndex }: KpiCardProps) {
  const t = useTranslations('overview');

  return (
    <article
      className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-[#e4e7eb] bg-white px-[15px] py-[14px] duration-300 animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
      style={{ animationDelay: `${iconIndex * 50}ms` }}
    >
      <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
        {t(`kpi.${kpi.labelKey}`)}
      </span>

      <div className="text-[24px] font-bold leading-none tracking-[-0.02em] text-[#15171c]">
        {kpi.value}
      </div>

      <div className="text-[10.5px] font-bold text-[#5b626d]">
        <span className="text-[8px] text-[#15171c]">▲</span> {kpi.delta}
      </div>

      <svg
        className="h-[22px] w-full text-[#5b626d]"
        viewBox="0 0 100 22"
        preserveAspectRatio="none"
      >
        <polyline
          points={kpi.spark}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.9"
        />
      </svg>
    </article>
  );
}
