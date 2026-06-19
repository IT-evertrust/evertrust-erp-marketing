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

export type EngineActivityItem = {
  time: string;
  source: string;
  message: string;
};