'use client';

import { useQuery } from '@tanstack/react-query';
import type { NicheDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// The org's niche catalog — powers the AIM pick-or-create field. `enabled` lets
// the dialog fetch lazily (only while it's open) so we don't poll for a list the
// user may never see.
export function useNiches(enabled = true) {
  return useQuery<NicheDto[], ApiError>({
    queryKey: queryKeys.niches.list(),
    queryFn: ({ signal }) => api.niches.list(signal),
    enabled,
    staleTime: 60_000,
  });
}
