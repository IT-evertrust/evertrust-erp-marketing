import {
  Activity,
  BarChart3,
  CalendarCheck,
  MailCheck,
  MessageSquare,
  TrendingUp,
  Users,
} from 'lucide-react';

import type { OverviewKpi } from '../types';

type KpiCardProps = {
  kpi: OverviewKpi;
  iconIndex: number;
};

export function KpiCard({ kpi, iconIndex }: KpiCardProps) {
  const icons = [
    Users,
    MailCheck,
    MessageSquare,
    TrendingUp,
    CalendarCheck,
    BarChart3,
  ];

  const Icon = icons[iconIndex] ?? Activity;

  return (
    <article className="min-w-0 rounded-[10px] border border-[#e4e7eb] bg-white px-[15px] py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
          {kpi.label}
        </span>
        <Icon className="h-4 w-4 text-[#959ca7]" />
      </div>

      <div className="mt-2 text-[24px] font-bold leading-none tracking-[-0.02em] text-[#15171c]">
        {kpi.value}
      </div>

      <div className="mt-2 text-[10.5px] font-bold text-[#5b626d]">
        <span className="text-[#15171c]">▲</span> {kpi.delta}
      </div>

      <svg
        className="mt-2 h-[22px] w-full"
        viewBox="0 0 100 22"
        preserveAspectRatio="none"
      >
        <polyline
          points={kpi.spark}
          fill="none"
          stroke="#5b626d"
          strokeWidth="1.5"
          opacity="0.9"
        />
      </svg>
    </article>
  );
}