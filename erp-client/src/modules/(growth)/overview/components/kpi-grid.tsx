import { KpiCard } from './kpi-card';
import type { OverviewKpi } from '../types';

type KpiGridProps = {
  kpis: OverviewKpi[];
};

export function KpiGrid({ kpis }: KpiGridProps) {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
      {kpis.map((kpi, index) => (
        <KpiCard key={kpi.label} kpi={kpi} iconIndex={index} />
      ))}
    </section>
  );
}