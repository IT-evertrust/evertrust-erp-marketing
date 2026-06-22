'use client';

import {
  Activity,
  BarChart3,
  CalendarCheck,
  MailCheck,
  MessageSquare,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { OverviewKpi } from '../types';

type KpiCardProps = {
  kpi: OverviewKpi;
  iconIndex: number;
};

export function KpiCard({ kpi, iconIndex }: KpiCardProps) {
  const t = useTranslations('overview');
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
    <article
      className="gc-lift min-w-0 rounded-[10px] border border-border bg-card px-[15px] py-3.5 duration-300 animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
      style={{ animationDelay: `${iconIndex * 50}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {t(`kpi.${kpi.labelKey}`)}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground transition-colors" />
      </div>

      <div className="mt-2 text-[24px] font-bold leading-none tracking-[-0.02em] text-foreground">
        {kpi.value}
      </div>

      <div className="mt-2 text-[10.5px] font-bold text-muted-foreground">
        <span className="text-foreground">▲</span> {kpi.delta}
      </div>

      <svg
        className="mt-2 h-[22px] w-full text-muted-foreground"
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