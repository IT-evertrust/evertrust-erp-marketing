'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProspectListDto,
  ProspectStatus,
  UpdateProspectStageDto,
  UpdateProspectStatusDto,
} from '@evertrust/shared';
import { ApiError, api, type ProspectDetail } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type ProspectBoardFilters = {
  campaignId?: string;
  status?: ProspectStatus;
  q?: string;
  nicheTargetId?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
};

// The cold-outreach board: a page of prospects + total + per-status tally. Polls
// so deploy/reply stages reflect without a manual refresh.
export function useProspectsBoard(filters: ProspectBoardFilters = {}) {
  return useQuery<ProspectListDto, ApiError>({
    queryKey: queryKeys.prospects.board(filters),
    queryFn: ({ signal }) => api.prospects.board(filters, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

// One prospect for the drawer: the row + resolved campaign/niche-target names.
export function useProspectDetail(id: string | null) {
  return useQuery<ProspectDetail, ApiError>({
    queryKey: queryKeys.prospects.detail(id ?? 'none'),
    queryFn: ({ signal }) => api.prospects.detail(id as string, signal),
    enabled: !!id,
  });
}

// Manual status override (archive / re-open / mark do-not-contact). Optimistically
// flips the status (and re-tallies statusCounts) on every cached board page so the
// row + chips move instantly; rolls back on error; invalidates the prospect tree
// on settle (the row may move pages, and the detail/list must re-read).
export function useUpdateProspectStatus() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.prospects.setStatus>>,
    ApiError,
    { id: string; patch: UpdateProspectStatusDto },
    { snapshots: [readonly unknown[], ProspectListDto][] }
  >({
    mutationFn: ({ id, patch }) => api.prospects.setStatus(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.prospects.all });
      const snapshots = queryClient.getQueriesData<ProspectListDto>({
        queryKey: queryKeys.prospects.board(),
        exact: false,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const target = data.items.find((p) => p.id === id);
        if (!target || target.status === patch.status) continue;
        const counts = { ...data.statusCounts };
        counts[target.status] = Math.max(0, (counts[target.status] ?? 1) - 1);
        counts[patch.status] = (counts[patch.status] ?? 0) + 1;
        queryClient.setQueryData<ProspectListDto>(key, {
          ...data,
          items: data.items.map((p) =>
            p.id === id ? { ...p, status: patch.status } : p,
          ),
          statusCounts: counts,
        });
      }
      return {
        snapshots: snapshots.filter(
          (s): s is [readonly unknown[], ProspectListDto] => !!s[1],
        ),
      };
    },
    onError: (_e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prospects.detail(vars.id),
      });
    },
  });
}

// Set a card's € deal value on the Nurture board. Optimistically writes the new
// dealValue on every cached board page so the card + column total update instantly;
// rolls back on error; invalidates the prospect tree on settle. Mirrors the
// optimistic shape of useUpdateProspectStage.
export function useUpdateProspectDeal() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.prospects.updateDeal>>,
    ApiError,
    { id: string; dealValue: number },
    { snapshots: [readonly unknown[], ProspectListDto][] }
  >({
    mutationFn: ({ id, dealValue }) => api.prospects.updateDeal(id, dealValue),
    onMutate: async ({ id, dealValue }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.prospects.all });
      const snapshots = queryClient.getQueriesData<ProspectListDto>({
        queryKey: queryKeys.prospects.board(),
        exact: false,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const target = data.items.find((p) => p.id === id);
        if (!target || target.dealValue === dealValue) continue;
        queryClient.setQueryData<ProspectListDto>(key, {
          ...data,
          items: data.items.map((p) =>
            p.id === id ? { ...p, dealValue } : p,
          ),
        });
      }
      return {
        snapshots: snapshots.filter(
          (s): s is [readonly unknown[], ProspectListDto] => !!s[1],
        ),
      };
    },
    onError: (_e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prospects.detail(vars.id),
      });
    },
  });
}

// Remove a card from the Nurture board. Optimistically drops the prospect from every
// cached board page (and decrements its stage tally) so the card disappears instantly;
// rolls back on error; invalidates the prospect tree on settle.
export function useDeleteProspect() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.prospects.removeCard>>,
    ApiError,
    { id: string },
    { snapshots: [readonly unknown[], ProspectListDto][] }
  >({
    mutationFn: ({ id }) => api.prospects.removeCard(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.prospects.all });
      const snapshots = queryClient.getQueriesData<ProspectListDto>({
        queryKey: queryKeys.prospects.board(),
        exact: false,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const target = data.items.find((p) => p.id === id);
        if (!target) continue;
        const counts = { ...data.stageCounts };
        counts[target.pipelineStage] = Math.max(
          0,
          (counts[target.pipelineStage] ?? 1) - 1,
        );
        queryClient.setQueryData<ProspectListDto>(key, {
          ...data,
          items: data.items.filter((p) => p.id !== id),
          total: Math.max(0, data.total - 1),
          stageCounts: counts,
        });
      }
      return {
        snapshots: snapshots.filter(
          (s): s is [readonly unknown[], ProspectListDto] => !!s[1],
        ),
      };
    },
    onError: (_e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prospects.detail(vars.id),
      });
    },
  });
}

// Move a card on the Nurture kanban (drag-and-drop). Optimistically flips the
// prospect's pipelineStage and re-tallies stageCounts on every cached board page so
// the card jumps columns instantly; rolls back on error; invalidates on settle.
export function useUpdateProspectStage() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.prospects.setStage>>,
    ApiError,
    { id: string; patch: UpdateProspectStageDto },
    { snapshots: [readonly unknown[], ProspectListDto][] }
  >({
    mutationFn: ({ id, patch }) => api.prospects.setStage(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.prospects.all });
      const snapshots = queryClient.getQueriesData<ProspectListDto>({
        queryKey: queryKeys.prospects.board(),
        exact: false,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const target = data.items.find((p) => p.id === id);
        if (!target || target.pipelineStage === patch.pipelineStage) continue;
        const counts = { ...data.stageCounts };
        counts[target.pipelineStage] = Math.max(
          0,
          (counts[target.pipelineStage] ?? 1) - 1,
        );
        counts[patch.pipelineStage] = (counts[patch.pipelineStage] ?? 0) + 1;
        queryClient.setQueryData<ProspectListDto>(key, {
          ...data,
          items: data.items.map((p) =>
            p.id === id ? { ...p, pipelineStage: patch.pipelineStage } : p,
          ),
          stageCounts: counts,
        });
      }
      return {
        snapshots: snapshots.filter(
          (s): s is [readonly unknown[], ProspectListDto] => !!s[1],
        ),
      };
    },
    onError: (_e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prospects.detail(vars.id),
      });
    },
  });
}
