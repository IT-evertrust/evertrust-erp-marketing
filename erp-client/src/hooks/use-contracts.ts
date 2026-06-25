'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContractDto,
  CreateContractDto,
  UpdateContractDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type ContractParams = {
  campaignId?: string;
};

// Contract Assist deal rows (newest first), optionally scoped to a campaign.
// `enabled` gates the fetch so an unselected campaign never fires a request.
export function useContracts(params: ContractParams = {}, enabled = true) {
  return useQuery<ContractDto[], ApiError>({
    queryKey: queryKeys.contracts.list(params),
    queryFn: ({ signal }) => api.contracts.list(params, signal),
    enabled,
  });
}

// Create a (possibly blank) row. Invalidates the whole contracts cache so the new
// row appears under whatever scope is active.
export function useCreateContract() {
  const queryClient = useQueryClient();
  return useMutation<ContractDto, ApiError, CreateContractDto | void>({
    mutationFn: (input) => api.contracts.create(input ?? {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
    },
  });
}

// Patch any subset of a row's fields (inline edits, status flips).
export function useUpdateContract() {
  const queryClient = useQueryClient();
  return useMutation<
    ContractDto,
    ApiError,
    { id: string; patch: UpdateContractDto }
  >({
    mutationFn: ({ id, patch }) => api.contracts.update(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
    },
  });
}

// Delete a row.
export function useDeleteContract() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, ApiError, string>({
    mutationFn: (id) => api.contracts.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
    },
  });
}
