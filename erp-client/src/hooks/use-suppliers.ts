'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSupplierDto,
  SupplierDto,
  UpdateSupplierDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Supplier registry for the current tenant.
export function useSuppliers() {
  return useQuery<SupplierDto[], ApiError>({
    queryKey: queryKeys.suppliers.list(),
    queryFn: ({ signal }) => api.suppliers.list(signal),
  });
}

// A single supplier by id.
export function useSupplier(id: string | undefined) {
  return useQuery<SupplierDto, ApiError>({
    queryKey: queryKeys.suppliers.detail(id ?? ''),
    queryFn: ({ signal }) => api.suppliers.get(id as string, signal),
    enabled: Boolean(id),
  });
}

// Create a supplier; refresh the registry list.
export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation<SupplierDto, ApiError, CreateSupplierDto>({
    mutationFn: (input) => api.suppliers.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
    },
  });
}

// Update a supplier; seed its detail cache and refresh the list.
export function useUpdateSupplier(id: string) {
  const queryClient = useQueryClient();
  return useMutation<SupplierDto, ApiError, UpdateSupplierDto>({
    mutationFn: (input) => api.suppliers.update(id, input),
    onSuccess: (supplier) => {
      queryClient.setQueryData(queryKeys.suppliers.detail(id), supplier);
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.list() });
    },
  });
}
