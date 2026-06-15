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
  WorkflowConfigDto,
  UpdateWorkflowConfigDto,
  LeadStatsDto,
  TestN8nResultDto,
  RotateIngestTokenResultDto,
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

// The resolved Growth-Engine workflow config (webhooks, n8n wiring, secret-status
// flags, cadence/sender) — backs the editable Configuration control panel.
export function useWorkflowConfig() {
  return useQuery<WorkflowConfigDto, ApiError>({
    queryKey: queryKeys.arsenal.config(),
    queryFn: ({ signal }) => api.arsenal.getConfig(signal),
    refetchOnWindowFocus: true,
  });
}

// Org-scoped lead/prospect/suppression tallies for the Configuration > Leads
// metric strip. Refetches on focus so the counts stay roughly fresh.
export function useLeadStats() {
  return useQuery<LeadStatsDto, ApiError>({
    queryKey: queryKeys.arsenal.leadStats(),
    queryFn: ({ signal }) => api.arsenal.leadStats(signal),
    refetchOnWindowFocus: true,
  });
}

// Partial-update the workflow config. Seeds the config cache with the freshly
// resolved value (so the form reflects the saved overrides immediately) and
// invalidates the run-state queries so the sequence/strip pick up the new wiring.
export function useUpdateWorkflowConfig() {
  const queryClient = useQueryClient();
  return useMutation<WorkflowConfigDto, ApiError, UpdateWorkflowConfigDto>({
    mutationFn: (input) => api.arsenal.updateConfig(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.arsenal.config(), saved);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.arsenal.executions(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.runs() });
    },
  });
}

// Probe the live n8n connection. No cache write — the component renders the
// returned result inline (the endpoint is read-only / never mutates config).
export function useTestN8n() {
  return useMutation<TestN8nResultDto, ApiError, void>({
    mutationFn: () => api.arsenal.testN8n(),
  });
}

// Rotate the machine ingest token. The plaintext token is shown once by the
// component; we invalidate the config query so the status flips to source
// 'rotated' after the dialog closes.
export function useRotateIngestToken() {
  const queryClient = useQueryClient();
  return useMutation<RotateIngestTokenResultDto, ApiError, void>({
    mutationFn: () => api.arsenal.rotateToken(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.config() });
    },
  });
}

// Revert machine-route auth to the env token. Seeds the config cache with the
// freshly-resolved config (status → 'env' or 'none').
export function useClearIngestToken() {
  const queryClient = useQueryClient();
  return useMutation<WorkflowConfigDto, ApiError, void>({
    mutationFn: () => api.arsenal.clearIngestToken(),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.arsenal.config(), saved);
    },
  });
}

// The signature-image endpoints return only the resolved URL, so we invalidate the
// config query (rather than seed it) to pull the freshly-resolved templates group.
type SignatureImageResult = { signatureImageUrl: string | null };

// Upload a signature image file (multipart → POST).
export function useUploadSignatureImage() {
  const queryClient = useQueryClient();
  return useMutation<SignatureImageResult, ApiError, File>({
    mutationFn: (file) => api.arsenal.uploadSignatureImage(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.config() });
    },
  });
}

// Point the signature image at a pasted URL (Drive share link or image URL).
export function useSetSignatureImageUrl() {
  const queryClient = useQueryClient();
  return useMutation<SignatureImageResult, ApiError, string>({
    mutationFn: (url) => api.arsenal.setSignatureImageUrl(url),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.config() });
    },
  });
}

// Clear the signature image (DELETE).
export function useClearSignatureImage() {
  const queryClient = useQueryClient();
  return useMutation<SignatureImageResult, ApiError, void>({
    mutationFn: () => api.arsenal.clearSignatureImage(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.arsenal.config() });
    },
  });
}
