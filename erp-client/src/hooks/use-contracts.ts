'use client';

import { useQuery } from '@tanstack/react-query';
import type { ContractDto, ContractStatus } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type ContractFilters = {
  leadId?: string;
  campaignId?: string;
  status?: ContractStatus;
};

// Contracts (ContractMaker output; the PDF lives in Drive). Read-only here —
// surfaced on the lead detail + campaign detail. `enabled` gates the fetch so it
// only fires when a scope (leadId / campaignId) is present.
export function useContracts(filters: ContractFilters = {}, enabled = true) {
  return useQuery<ContractDto[], ApiError>({
    queryKey: queryKeys.contracts.list(filters),
    queryFn: ({ signal }) => api.contracts.list(filters, signal),
    enabled,
  });
}
