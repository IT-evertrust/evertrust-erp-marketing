'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateCustomerDto,
  CustomerDto,
  UpdateCustomerDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Customer registry for the current tenant.
export function useCustomers() {
  return useQuery<CustomerDto[], ApiError>({
    queryKey: queryKeys.customers.list(),
    queryFn: ({ signal }) => api.customers.list(signal),
  });
}

// A single customer by id.
export function useCustomer(id: string | undefined) {
  return useQuery<CustomerDto, ApiError>({
    queryKey: queryKeys.customers.detail(id ?? ''),
    queryFn: ({ signal }) => api.customers.get(id as string, signal),
    enabled: Boolean(id),
  });
}

// Create a customer; refresh the registry list.
export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation<CustomerDto, ApiError, CreateCustomerDto>({
    mutationFn: (input) => api.customers.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
    },
  });
}

// Update a customer; seed its detail cache and refresh the list.
export function useUpdateCustomer(id: string) {
  const queryClient = useQueryClient();
  return useMutation<CustomerDto, ApiError, UpdateCustomerDto>({
    mutationFn: (input) => api.customers.update(id, input),
    onSuccess: (customer) => {
      queryClient.setQueryData(queryKeys.customers.detail(id), customer);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.list() });
    },
  });
}
