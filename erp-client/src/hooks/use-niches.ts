'use client';

import { useQuery } from '@tanstack/react-query';
import type { NicheListItemDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// The org's niche catalog — powers the AIM pick-or-create field. `enabled` lets
// the dialog fetch lazily (only while it's open) so we don't poll for a list the
// user may never see. GET /niches returns the enriched list-item shape (a superset
// of the combobox id/name/slug), so the picker can also read `industryName` to
// group options without a second request.
export function useNiches(enabled = true) {
  return useQuery<NicheListItemDto[], ApiError>({
    queryKey: queryKeys.niches.list(),
    queryFn: ({ signal }) => api.niches.list(signal),
    enabled,
    staleTime: 60_000,
  });
}
