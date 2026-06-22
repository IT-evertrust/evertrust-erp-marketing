// Stable translation key for a KPI tile (resolves to overview.kpi.<labelKey>). The
// label text itself is rendered via next-intl in the component, so the catalog is
// the single source of truth for the copy in every locale.
export type OverviewKpiKey =
  | 'newLeads'
  | 'contacted'
  | 'replyRate'
  | 'interested'
  | 'meetings'
  | 'pipelineValue';

export type OverviewKpi = {
  labelKey: OverviewKpiKey;
  value: string;
  delta: string;
  spark: string;
};

// Stable translation key for a funnel stage (resolves to overview.funnel.stage.<nameKey>).
export type FunnelStageKey = 'reach' | 'engage' | 'activate' | 'nurture' | 'won';

export type FunnelStage = {
  nameKey: FunnelStageKey;
  value: string;
  width: number;
  conversion: string;
};

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';

export type EngineActivityItem = {
  time: string;
  source: string;
  message: string;
  level?: ActivityLevel;
  at?: string;
};

// A condition that needs attention, surfaced above the activity log.
export type EngineAlert = {
  id: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string | null;
  source: string;
  time: string;
};