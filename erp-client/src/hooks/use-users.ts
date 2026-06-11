'use client';

import { useQuery } from '@tanstack/react-query';
import type { UserListItemDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Org user directory for pickers (e.g. the tender assignee Select). Authenticated
// users may read their own org's directory; the API tenant-scopes the result.
export function useUsers() {
  return useQuery<UserListItemDto[], ApiError>({
    queryKey: queryKeys.users.list(),
    queryFn: ({ signal }) => api.users.list(signal),
  });
}
