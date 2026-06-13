'use client';

import { useQuery } from '@tanstack/react-query';
import type { HealthDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Public API health probe (status/db) for the Configuration integrations panel.
export function useHealth() {
  return useQuery<HealthDto, ApiError>({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
