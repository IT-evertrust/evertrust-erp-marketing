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
