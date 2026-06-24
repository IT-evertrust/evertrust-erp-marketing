// Shapes the Overview "Engine Activity" surface returns to the web client. The frontend renders
// these directly (level drives the dot colour; alerts render above the activity log).

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';

// One thing that happened in the engine (a stage run, a workflow execution, a reply verdict,
// a meeting booked/analyzed). `at` is the ISO timestamp; `time` is the pre-formatted label.
export type EngineActivityItem = {
  at: string;
  time: string;
  source: string;
  message: string;
  level: ActivityLevel;
};

// A condition that needs attention (a failed run, a revoked Google grant, due follow-ups, a
// system notification). Ordered by severity then recency.
export type EngineAlert = {
  id: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string | null;
  source: string;
  time: string;
};

export type OverviewActivity = {
  activity: EngineActivityItem[];
  alerts: EngineAlert[];
};

// A headline metric card. `value`/`delta` are pre-formatted strings; `spark` is an
// SVG polyline points string (viewBox 0 0 100 22) of the last 7 days' daily counts.
export type OverviewKpi = {
  label: string;
  value: string;
  delta: string;
  spark: string;
};

// One R-E-A-N funnel stage with its real count. `width` is 0-100 (scaled to the
// largest stage); `conversion` is the stage as a % of Reach.
export type FunnelStage = {
  name: string;
  value: string;
  width: number;
  conversion: string;
};

// The dashboard summary: real KPI cards + R-E-A-N funnel for the org. Activity is a
// separate endpoint (getActivity).
export type OverviewSummary = {
  kpis: OverviewKpi[];
  funnel: FunnelStage[];
};
