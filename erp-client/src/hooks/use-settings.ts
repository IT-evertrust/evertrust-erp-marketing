'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrgSettingsDto, UpdateOrgSettingsDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// The org's effective Growth Engine settings (Settings page). Resolved
// server-side as (org_config value ?? default), so values are never null except
// sender identity (which legitimately has none).
export function useOrgSettings() {
  return useQuery<OrgSettingsDto, ApiError>({
    queryKey: queryKeys.settings.all,
    queryFn: ({ signal }) => api.settings.get(signal),
  });
}

// Persist a partial update. The PATCH returns the full settings, so seed the
// cache with the response (re-seeding the form) and invalidate to stay in sync.
export function useUpdateOrgSettings() {
  const queryClient = useQueryClient();

  return useMutation<OrgSettingsDto, ApiError, UpdateOrgSettingsDto>({
    mutationFn: (patch) => api.settings.update(patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.settings.all, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
}
