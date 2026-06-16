'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateKpiValueDto,
  KpiDefinitionDto,
  KpiPeriod,
  PerformanceBriefDto,
  PerformanceOverviewDto,
  ScorecardDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Performance Management System hooks. Scorecards feed the leaderboard + drawer;
// overview feeds the Executive tab. Both are read-only (computed server-side).
export function useScorecards(period: KpiPeriod = 'WEEKLY') {
  return useQuery<ScorecardDto[], ApiError>({
    queryKey: queryKeys.performance.scorecards(period),
    queryFn: ({ signal }) => api.performance.scorecards(period, signal),
    refetchOnWindowFocus: false,
  });
}

export function useOverview(period: KpiPeriod = 'WEEKLY') {
  return useQuery<PerformanceOverviewDto, ApiError>({
    queryKey: queryKeys.performance.overview(period),
    queryFn: ({ signal }) => api.performance.overview(period, signal),
    refetchOnWindowFocus: false,
  });
}

export function useKpiDefinitions() {
  return useQuery<KpiDefinitionDto[], ApiError>({
    queryKey: queryKeys.performance.definitions(),
    queryFn: ({ signal }) => api.performance.definitions(signal),
    refetchOnWindowFocus: false,
  });
}

export function useBrief(period: KpiPeriod = 'WEEKLY') {
  return useQuery<PerformanceBriefDto, ApiError>({
    queryKey: queryKeys.performance.brief(period),
    queryFn: ({ signal }) => api.performance.brief(period, signal),
    refetchOnWindowFocus: false,
  });
}

export function useGenerateBrief(period: KpiPeriod = 'WEEKLY') {
  const qc = useQueryClient();
  return useMutation<PerformanceBriefDto, ApiError, void>({
    mutationFn: () => api.performance.generateBrief(period),
    onSuccess: (data) =>
      qc.setQueryData(queryKeys.performance.brief(period), data),
  });
}

export function useCreateKpiValue() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, ApiError, CreateKpiValueDto>({
    mutationFn: (input) => api.performance.createKpiValue(input),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: queryKeys.performance.all }),
  });
}
