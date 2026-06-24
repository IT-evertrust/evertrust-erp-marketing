import { KpiCard } from './kpi-card';
import type { OverviewKpi } from '../types';

type KpiGridProps = {
  kpis: OverviewKpi[];
  // 6 = full-width strip (default); 2 = the 2×3 block that sits beside the funnel
  // in the design's bottom row.
  columns?: 2 | 6;
};

export function KpiGrid({ kpis, columns = 6 }: KpiGridProps) {
  const grid =
    columns === 2
      ? 'grid grid-cols-1 gap-3 sm:grid-cols-2'
      : 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6';
  return (
    <section className={grid}>
      {kpis.map((kpi, index) => (
        <KpiCard key={kpi.label} kpi={kpi} iconIndex={index} />
      ))}
    </section>
  );
}