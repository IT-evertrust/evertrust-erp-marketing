'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClearResultDto,
  CreateLeadDto,
  LeadBackfillResultDto,
  LeadDto,
  LeadStage,
  ProvisionHotLeadsResultDto,
  RunHotLeadsPipelineResultDto,
  UpdateLeadDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Key Account hot-lead CRM hooks. The board reads useLeads(); mutations invalidate
// the whole leads tree so every column refreshes.

export function useLeads(filters: { stage?: LeadStage; campaignId?: string } = {}) {
  return useQuery<LeadDto[], ApiError>({
    queryKey: queryKeys.leads.list(filters.stage, filters.campaignId),
    queryFn: ({ signal }) => api.leads.list(filters, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function useInvalidateLeads() {
  const queryClient = useQueryClient();
  return () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
}

export function useCreateLead() {
  const invalidate = useInvalidateLeads();
  return useMutation<LeadDto, ApiError, CreateLeadDto>({
    mutationFn: (input) => api.leads.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateLead() {
  const invalidate = useInvalidateLeads();
  return useMutation<LeadDto, ApiError, { id: string; patch: UpdateLeadDto }>({
    mutationFn: ({ id, patch }) => api.leads.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useConvertLead() {
  const queryClient = useQueryClient();
  return useMutation<LeadDto, ApiError, string>({
    mutationFn: (id) => api.leads.convert(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
    },
  });
}

export function useLeadsBackfill() {
  const invalidate = useInvalidateLeads();
  return useMutation<LeadBackfillResultDto, ApiError, void>({
    mutationFn: () => api.leads.backfill(),
    onSuccess: invalidate,
  });
}

export function useClearLeads() {
  const invalidate = useInvalidateLeads();
  return useMutation<ClearResultDto, ApiError, void>({
    mutationFn: () => api.leads.clear(),
    onSuccess: invalidate,
  });
}

export function useProvisionHotLeads() {
  return useMutation<ProvisionHotLeadsResultDto, ApiError, string>({
    mutationFn: (campaignId) => api.leads.provision(campaignId),
  });
}

export function useRunHotLeadsPipeline() {
  const invalidate = useInvalidateLeads();
  return useMutation<RunHotLeadsPipelineResultDto, ApiError, string | undefined>({
    mutationFn: (campaignId) => api.leads.runPipeline(campaignId),
    onSuccess: invalidate,
  });
}
