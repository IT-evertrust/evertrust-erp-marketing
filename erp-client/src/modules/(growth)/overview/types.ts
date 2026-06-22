export type OverviewKpi = {
  label: string;
  value: string;
  delta: string;
  spark: string;
};

export type FunnelStage = {
  name: string;
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
