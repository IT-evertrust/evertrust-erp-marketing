'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SuppressionListItemDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// The org's do-not-contact (suppression) list.
export function useSuppressions() {
  return useQuery<SuppressionListItemDto[], ApiError>({
    queryKey: queryKeys.suppressions.list(),
    queryFn: ({ signal }) => api.suppressions.list(signal),
  });
}

// Un-suppress one address (the human override). Optimistically removes the row;
// rolls back on error; re-fetches the list on settle.
export function useDeleteSuppression() {
  const queryClient = useQueryClient();
  const listKey = queryKeys.suppressions.list();
  return useMutation<
    { deleted: number },
    ApiError,
    string,
    { previous?: SuppressionListItemDto[] }
  >({
    mutationFn: (id) => api.suppressions.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<SuppressionListItemDto[]>(listKey);
      if (previous) {
        queryClient.setQueryData<SuppressionListItemDto[]>(
          listKey,
          previous.filter((s) => s.id !== id),
        );
      }
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
