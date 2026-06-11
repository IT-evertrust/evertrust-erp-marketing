'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArsenalBackfillResultDto,
  ClearResultDto,
  ArsenalExecutionsDto,
  ArsenalRunDto,
  ArsenalSettingsDto,
  ArsenalStage,
  MarketingReportDto,
  MarketingReportPeriod,
  UpdateArsenalSettingsDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Arsenal trigger hooks. Recent runs is the ERP→n8n hand-off history; the run
// mutation fires a stage's webhook (server records + returns the run, whose status
// is DISPATCHED or FAILED). Every run invalidates the run history.

export function useArsenalRuns() {
  return useQuery<ArsenalRunDto[], ApiError>({
    queryKey: queryKeys.arsenal.runs(),
    queryFn: ({ signal }) => api.arsenal.listRuns(signal),
    // Keep the sequence + live feed in sync without a manual refresh.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useRunArsenalStage() {
  const queryClient = useQueryClient();
  return useMutation<
    ArsenalRunDto,
    ApiError,
    { stage: ArsenalStage; campaignId?: string }
  >({
    mutationFn: ({ stage, campaignId }) => api.arsenal.run(stage, { campaignId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.runs() });
    },
  });
}

// Live per-stage n8n execution status (the real run-state poller). Polls ~10s.
// configured=false when the n8n API isn't wired up — the strip then falls back to
// its dispatch-based status.
export function useArsenalExecutions() {
  return useQuery<ArsenalExecutionsDto, ApiError>({
    queryKey: queryKeys.arsenal.executions(),
    queryFn: ({ signal }) => api.arsenal.executions(signal),
    // Snappy live run-state: poll every 5s so RUNNING->END shows promptly.
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
}

// The Marketing report for a period (day/week/month), optionally scoped to one
// campaign. Polls ~30s so the report reflects new runs + n8n metric callbacks
// without a manual refresh.
export function useMarketingReport(
  period: MarketingReportPeriod,
  campaignId?: string | null,
) {
  return useQuery<MarketingReportDto, ApiError>({
    queryKey: queryKeys.arsenal.report(period, campaignId),
    queryFn: ({ signal }) => api.arsenal.report(period, campaignId, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

// Backfill the report from n8n execution history. On success, invalidates all
// arsenal queries so the report + feed pick up the imported runs/metrics.
export function useArsenalBackfill() {
  const queryClient = useQueryClient();
  return useMutation<ArsenalBackfillResultDto, ApiError, void>({
    mutationFn: () => api.arsenal.backfill(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.all });
    },
  });
}

// Clear the run feed (test-data reset). Invalidates the whole arsenal tree.
export function useClearArsenalRuns() {
  const queryClient = useQueryClient();
  return useMutation<ClearResultDto, ApiError, void>({
    mutationFn: () => api.arsenal.clearRuns(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.all });
    },
  });
}

// The editable daily Bazooka send time.
export function useArsenalSettings() {
  return useQuery<ArsenalSettingsDto, ApiError>({
    queryKey: queryKeys.arsenal.settings(),
    queryFn: ({ signal }) => api.arsenal.getSettings(signal),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

// Set/clear the daily time. Seeds the settings cache with the saved value so the
// control reflects it immediately (the API also re-arms the scheduler).
export function useUpdateArsenalSettings() {
  const queryClient = useQueryClient();
  return useMutation<ArsenalSettingsDto, ApiError, UpdateArsenalSettingsDto>({
    mutationFn: (input) => api.arsenal.updateSettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.arsenal.settings(), saved);
    },
  });
}
