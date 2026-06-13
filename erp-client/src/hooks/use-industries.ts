'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IndustryDto,
  IndustryListItemDto,
  NicheDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Growth Engine: industries are niche grouping parents (one industry → many
// niches), org-scoped, for grouping/search ONLY — never part of lead research.
// Every mutation here touches BOTH lists: the industry list (its nicheCount) and
// the niche list (each niche's industryId/industryName), so each invalidates both.

// The org's industries with their rollup niche counts (the management list).
export function useIndustries(enabled = true) {
  return useQuery<IndustryListItemDto[], ApiError>({
    queryKey: queryKeys.industries.list(),
    queryFn: ({ signal }) => api.industries.list(signal),
    enabled,
  });
}

// Refresh both the industry list and the niche list after any grouping change.
function useInvalidateGrouping() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.industries.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.niches.all });
  };
}

// Create an industry (deduped by org + slugify(name) server-side).
export function useCreateIndustry() {
  const invalidate = useInvalidateGrouping();
  return useMutation<IndustryDto, ApiError, string>({
    mutationFn: (name) => api.industries.create({ name }),
    onSuccess: invalidate,
  });
}

// Rename an industry (409 on a sibling slug clash in the same org).
export function useRenameIndustry() {
  const invalidate = useInvalidateGrouping();
  return useMutation<IndustryDto, ApiError, { id: string; name: string }>({
    mutationFn: ({ id, name }) => api.industries.rename(id, { name }),
    onSuccess: invalidate,
  });
}

// Delete an industry (409 if niches are still assigned to it).
export function useDeleteIndustry() {
  const invalidate = useInvalidateGrouping();
  return useMutation<{ deleted: number }, ApiError, string>({
    mutationFn: (id) => api.industries.remove(id),
    onSuccess: invalidate,
  });
}

// Assign a niche to an industry, or unassign it (industryId = null). Mutates the
// niche's grouping parent and both industries' nicheCounts.
export function useAssignNicheIndustry() {
  const invalidate = useInvalidateGrouping();
  return useMutation<
    NicheDto,
    ApiError,
    { nicheId: string; industryId: string | null }
  >({
    mutationFn: ({ nicheId, industryId }) =>
      api.niches.assignIndustry(nicheId, industryId),
    onSuccess: invalidate,
  });
}
