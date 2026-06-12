'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateNicheTargetDto,
  NicheListItemDto,
  NicheTargetDto,
  UpdateNicheTargetDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Growth Engine: niche catalog + per-niche target management. The niche list
// carries rollup counts; the targets list is the enable/disable/edit surface.

// The org's niches with target/campaign counts (the management list).
export function useNiches() {
  return useQuery<NicheListItemDto[], ApiError>({
    queryKey: queryKeys.niches.list(),
    queryFn: ({ signal }) => api.niches.list(signal),
  });
}

// A niche's targets (enabled + disabled). `enabled` gates the fetch so a closed
// drawer / unselected niche never fires a request.
export function useNicheTargets(nicheId: string | null, enabled = true) {
  return useQuery<NicheTargetDto[], ApiError>({
    queryKey: queryKeys.niches.targets(nicheId ?? 'none'),
    queryFn: ({ signal }) => api.niches.targets(nicheId as string, signal),
    enabled: enabled && !!nicheId,
  });
}

// Add a MANUAL target. Invalidates the niche's targets list (and the niche list,
// whose targetCount changes) so the new row + count appear immediately.
export function useAddNicheTarget(nicheId: string) {
  const queryClient = useQueryClient();
  return useMutation<NicheTargetDto, ApiError, CreateNicheTargetDto>({
    mutationFn: (input) => api.niches.addTarget(nicheId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.niches.targets(nicheId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.niches.list() });
    },
  });
}

// Enable/disable, rename, or re-hint a target. Optimistically patches the cached
// targets row so the Switch/name flips instantly; rolls back on error; always
// re-fetches on settle so the server row is authoritative.
export function useUpdateNicheTarget(nicheId: string) {
  const queryClient = useQueryClient();
  const listKey = queryKeys.niches.targets(nicheId);
  return useMutation<
    NicheTargetDto,
    ApiError,
    { id: string; patch: UpdateNicheTargetDto },
    { previous?: NicheTargetDto[] }
  >({
    mutationFn: ({ id, patch }) => api.nicheTargets.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<NicheTargetDto[]>(listKey);
      if (previous) {
        queryClient.setQueryData<NicheTargetDto[]>(
          listKey,
          previous.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  ...(patch.searchHint !== undefined
                    ? { searchHint: patch.searchHint }
                    : {}),
                }
              : t,
          ),
        );
      }
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}

// Delete a target. Optimistically removes the row; rolls back on error; refreshes
// the niche list (targetCount) on settle.
export function useDeleteNicheTarget(nicheId: string) {
  const queryClient = useQueryClient();
  const listKey = queryKeys.niches.targets(nicheId);
  return useMutation<
    { deleted: number },
    ApiError,
    string,
    { previous?: NicheTargetDto[] }
  >({
    mutationFn: (id) => api.nicheTargets.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<NicheTargetDto[]>(listKey);
      if (previous) {
        queryClient.setQueryData<NicheTargetDto[]>(
          listKey,
          previous.filter((t) => t.id !== id),
        );
      }
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.niches.list() });
    },
  });
}
