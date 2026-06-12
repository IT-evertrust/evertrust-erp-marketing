'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CampaignDto,
  CampaignFilesDto,
  CampaignSyncResultDto,
  CreateCampaignDto,
  UpdateCampaignLifecycleDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Pause / resume / archive target (DRAFT is never a target — campaigns only move
// forward out of DRAFT). Mirrors the shared UpdateCampaignLifecycleDto body.
type LifecycleTarget = UpdateCampaignLifecycleDto['lifecycle'];

// Files in a campaign's Drive folder — fetched lazily (only when the Details
// dialog is open, via `enabled`).
export function useCampaignFiles(id: string, enabled: boolean) {
  return useQuery<CampaignFilesDto, ApiError>({
    queryKey: queryKeys.campaigns.files(id),
    queryFn: ({ signal }) => api.campaigns.files(id, signal),
    enabled,
    staleTime: 30_000,
  });
}

// Growth Engine hooks. The list is the launched-campaign history; the create
// mutation is the AIM "Lock & Load" (it persists the campaign AND fires the AIM
// webhook server-side, so the returned row's status reflects the deploy outcome).

export function useCampaigns() {
  return useQuery<CampaignDto[], ApiError>({
    queryKey: queryKeys.campaigns.list(),
    queryFn: ({ signal }) => api.campaigns.list(signal),
    // Sync the sequence with deploy outcomes without a manual refresh.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

// One campaign by id (the campaign detail surface). The lifecycle mutation seeds
// this same key optimistically, so Pause/Resume/Archive flips the badge here too.
export function useCampaign(id: string | null) {
  return useQuery<CampaignDto, ApiError>({
    queryKey: queryKeys.campaigns.detail(id ?? 'none'),
    queryFn: ({ signal }) => api.campaigns.get(id as string, signal),
    enabled: !!id,
  });
}

// Launch a campaign. Invalidates the campaign list so the new row (with its
// DEPLOYED / FAILED / DRAFT status) appears immediately.
export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation<CampaignDto, ApiError, CreateCampaignDto>({
    mutationFn: (input) => api.campaigns.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
    },
  });
}

// Delete a campaign (ERP record only). Invalidates the list so the row disappears.
export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.campaigns.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
    },
  });
}

// Move a campaign through its lifecycle (Pause / Resume / Archive). Optimistically
// patches the cached list + detail so the badge flips instantly; on error we roll
// back, and we always re-fetch on settle so the server's row is authoritative.
export function useSetCampaignLifecycle() {
  const queryClient = useQueryClient();
  const listKey = queryKeys.campaigns.list();
  return useMutation<
    CampaignDto,
    ApiError,
    { id: string; lifecycle: LifecycleTarget },
    { previousList?: CampaignDto[] }
  >({
    mutationFn: ({ id, lifecycle }) => api.campaigns.setLifecycle(id, lifecycle),
    onMutate: async ({ id, lifecycle }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previousList = queryClient.getQueryData<CampaignDto[]>(listKey);
      if (previousList) {
        queryClient.setQueryData<CampaignDto[]>(
          listKey,
          previousList.map((c) => (c.id === id ? { ...c, lifecycle } : c)),
        );
      }
      queryClient.setQueryData<CampaignDto>(
        queryKeys.campaigns.detail(id),
        (c) => (c ? { ...c, lifecycle } : c),
      );
      return { previousList };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(listKey, context.previousList);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
    },
  });
}

// Sync the campaign list with the Drive "Evertrust Campaigns" folder (the source of
// truth): archives campaigns whose folder was deleted, un-archives ones that came
// back. Invalidates the list so archived rows drop out immediately.
export function useSyncCampaigns() {
  const queryClient = useQueryClient();
  return useMutation<CampaignSyncResultDto, ApiError, void>({
    mutationFn: () => api.campaigns.sync(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
    },
  });
}
