'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminUserDto,
  CreateUserDto,
  UpdateUserDto,
  UserStatsDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Admin user-management hooks (users:manage). The directory is the full user
// list; the update mutation PATCHes one user's role/position/department and keeps
// the table authoritative by seeding the saved row + invalidating the list.

export function useAdminUsers() {
  return useQuery<AdminUserDto[], ApiError>({
    queryKey: queryKeys.adminUsers.list(),
    queryFn: ({ signal }) => api.adminUsers.list(signal),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation<AdminUserDto, ApiError, { id: string; patch: UpdateUserDto }>({
    mutationFn: ({ id, patch }) => api.adminUsers.update(id, patch),
    onSuccess: (saved) => {
      queryClient.setQueryData<AdminUserDto[]>(queryKeys.adminUsers.list(), (prev) =>
        prev?.map((u) => (u.id === saved.id ? saved : u)),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers.all });
    },
  });
}

// Create a new user (admin-set initial password — this ERP has no register flow).
export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation<AdminUserDto, ApiError, CreateUserDto>({
    mutationFn: (input) => api.adminUsers.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers.all });
    },
  });
}

// Real per-user contribution stats for the profile page.
export function useUserStats(id: string) {
  return useQuery<UserStatsDto, ApiError>({
    queryKey: queryKeys.adminUsers.stats(id),
    queryFn: ({ signal }) => api.adminUsers.stats(id, signal),
  });
}

// Admin password reset — set a new password for a user.
export function useSetPassword() {
  return useMutation<{ id: string }, ApiError, { id: string; password: string }>(
    {
      mutationFn: ({ id, password }) => api.adminUsers.setPassword(id, password),
    },
  );
}

// Hard-delete a user. Drops the row from the cached list, then invalidates.
export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, ApiError, string>({
    mutationFn: (id) => api.adminUsers.remove(id),
    onSuccess: ({ id }) => {
      queryClient.setQueryData<AdminUserDto[]>(
        queryKeys.adminUsers.list(),
        (prev) => prev?.filter((u) => u.id !== id),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers.all });
    },
  });
}
