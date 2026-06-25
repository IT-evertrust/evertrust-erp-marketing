import { KpiCard } from './kpi-card';
import type { OverviewKpi } from '../types';

type KpiGridProps = {
  kpis: OverviewKpi[];
};

// The 2-column KPI grid that fills the right side of the Overview's bottom row
// (HTML `.kpi-grid` — 6 tiles in a 2×3 layout).
export function KpiGrid({ kpis }: KpiGridProps) {
  return (
    <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
      {kpis.map((kpi, index) => (
        <KpiCard key={kpi.labelKey} kpi={kpi} iconIndex={index} />
      ))}
    </div>
  );
}
