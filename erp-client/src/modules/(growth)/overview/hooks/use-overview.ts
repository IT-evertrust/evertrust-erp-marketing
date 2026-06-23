'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/env';

import type {
  EngineActivityItem,
  EngineAlert,
  FunnelStage,
  OverviewKpi,
} from '../types';

// The backend computes BOTH of these from the org's actual data (reach leads,
// outreach sends, reply classifications, meetings, prospects, contracts). There is
// no client-side mock/fallback any more — the dashboard shows real data or, while
// loading / on error, nothing (never synthesized numbers).
type OverviewSummary = {
  kpis: OverviewKpi[];
  funnel: FunnelStage[];
};

type OverviewActivityResponse = {
  activity: EngineActivityItem[];
  alerts: EngineAlert[];
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// Real org KPIs + R-E-A-N funnel, computed server-side. Polled so the cockpit stays
// roughly live.
function useOverviewSummary() {
  return useQuery<OverviewSummary, Error>({
    queryKey: ['growth', 'overview', 'summary'],
    queryFn: ({ signal }) => getJson<OverviewSummary>('/growth/overview', signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// The real cross-system Engine Activity feed + alerts.
function useEngineActivity() {
  return useQuery<OverviewActivityResponse, Error>({
    queryKey: ['growth', 'overview', 'activity'],
    queryFn: ({ signal }) =>
      getJson<OverviewActivityResponse>('/growth/overview/activity', signal),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useOverview() {
  const summary = useOverviewSummary();
  const engine = useEngineActivity();

  return {
    kpis: summary.data?.kpis ?? [],
    funnel: summary.data?.funnel ?? [],
    activity: engine.data?.activity ?? [],
    alerts: engine.data?.alerts ?? [],
    isLoading: summary.isLoading,
    isError: summary.isError,
  };
}
