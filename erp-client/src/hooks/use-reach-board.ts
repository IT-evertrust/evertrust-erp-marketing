'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateReachLeadBody,
  PipelineStage,
  ReachBoardResultDto,
  UpdateReachLeadDealBody,
} from '@evertrust/shared';

import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type ReachBoardFilters = {
  aimId?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

// The Nurture pipeline board, backed by reach_leads. Polls so deploy/reply/meeting
// updates (and meeting-driven deal values) reflect without a manual refresh.
export function useReachBoard(filters: ReachBoardFilters = {}) {
  return useQuery<ReachBoardResultDto, ApiError>({
    queryKey: queryKeys.reachBoard.board(filters),
    queryFn: ({ signal }) => api.reachBoard.board(filters, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

// Kanban drag → new pipeline stage. Optimistically moves the card's pipelineStage
// (and re-tallies stageCounts) on every cached board page so the card jumps columns
// instantly; rolls back on error; invalidates the board on settle.
export function useUpdateReachLeadStage() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.reachBoard.updateStage>>,
    ApiError,
    { id: string; stage: PipelineStage },
    { snapshots: [readonly unknown[], ReachBoardResultDto][] }
  >({
    mutationFn: ({ id, stage }) => api.reachBoard.updateStage(id, { stage }),
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reachBoard.all });
      const snapshots = queryClient.getQueriesData<ReachBoardResultDto>({
        queryKey: queryKeys.reachBoard.board(),
        exact: false,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const target = data.items.find((p) => p.id === id);
        if (!target || target.pipelineStage === stage) continue;
        const counts = { ...data.stageCounts };
        counts[target.pipelineStage] = Math.max(
          0,
          (counts[target.pipelineStage] ?? 1) - 1,
        );
        counts[stage] = (counts[stage] ?? 0) + 1;
        queryClient.setQueryData<ReachBoardResultDto>(key, {
          ...data,
          items: data.items.map((p) =>
            p.id === id ? { ...p, pipelineStage: stage } : p,
          ),
          stageCounts: counts,
        });
      }
      return {
        snapshots: snapshots.filter(
          (s): s is [readonly unknown[], ReachBoardResultDto] => !!s[1],
        ),
      };
    },
    onError: (_e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reachBoard.all });
    },
  });
}

// Add a Nurture card (the board's "+ Add deal"). Invalidates the board on success.
export function useCreateReachLead() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.reachBoard.create>>,
    ApiError,
    CreateReachLeadBody
  >({
    mutationFn: (body) => api.reachBoard.create(body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reachBoard.all });
    },
  });
}

// Delete a Nurture card (the × on hover). Optimistically drops it from every cached
// board page (and re-tallies its stage), then invalidates on settle.
export function useDeleteReachLead() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.reachBoard.remove>>,
    ApiError,
    { id: string },
    { snapshots: [readonly unknown[], ReachBoardResultDto][] }
  >({
    mutationFn: ({ id }) => api.reachBoard.remove(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reachBoard.all });
      const snapshots = queryClient.getQueriesData<ReachBoardResultDto>({
        queryKey: queryKeys.reachBoard.board(),
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
        queryClient.setQueryData<ReachBoardResultDto>(key, {
          ...data,
          items: data.items.filter((p) => p.id !== id),
          total: Math.max(0, data.total - 1),
          stageCounts: counts,
        });
      }
      return {
        snapshots: snapshots.filter(
          (s): s is [readonly unknown[], ReachBoardResultDto] => !!s[1],
        ),
      };
    },
    onError: (_e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reachBoard.all });
    },
  });
}

// Inline edit of a card's deal fields (deal value + contact name/phone). Optimistically
// patches the lead on every cached board page so the € value / contact update
// instantly; rolls back on error; invalidates the board on settle.
export function useUpdateReachLeadDeal() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.reachBoard.updateDeal>>,
    ApiError,
    { id: string; patch: UpdateReachLeadDealBody },
    { snapshots: [readonly unknown[], ReachBoardResultDto][] }
  >({
    mutationFn: ({ id, patch }) => api.reachBoard.updateDeal(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reachBoard.all });
      const snapshots = queryClient.getQueriesData<ReachBoardResultDto>({
        queryKey: queryKeys.reachBoard.board(),
        exact: false,
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        if (!data.items.some((p) => p.id === id)) continue;
        queryClient.setQueryData<ReachBoardResultDto>(key, {
          ...data,
          items: data.items.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...(patch.dealValue != null ? { dealValue: patch.dealValue } : {}),
                  ...(patch.contactName !== undefined
                    ? { contactName: patch.contactName ?? undefined }
                    : {}),
                  ...(patch.contactPhone !== undefined
                    ? { phone: patch.contactPhone ?? undefined }
                    : {}),
                }
              : p,
          ),
        });
      }
      return {
        snapshots: snapshots.filter(
          (s): s is [readonly unknown[], ReachBoardResultDto] => !!s[1],
        ),
      };
    },
    onError: (_e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reachBoard.all });
    },
  });
}
