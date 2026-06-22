'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginDto, LoginResponseDto, MeDto, UpdateMyNameDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { API_URL } from '@/lib/env';
import { getLandingPath } from '@/lib/preferences';
import { queryKeys } from '@/lib/query-keys';

// Login: verify credentials against the API, then hand the returned token to our
// own route handler so a web-origin mirror cookie exists for middleware gating.
// On success we seed the user cache and navigate to the user's chosen landing
// page (Settings → General → Display; defaults to /overview).
export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation<LoginResponseDto, ApiError, LoginDto>({
    mutationFn: async (input) => {
      const result = await api.login(input);
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: result.accessToken }),
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.me, result.user);
      router.replace(getLandingPath());
      router.refresh();
    },
  });
}

// Current user. Disabled retries on 401 so an unauthenticated session fails fast
// instead of hammering the API; the dashboard redirects on that error.
export function useMe() {
  return useQuery<MeDto, ApiError>({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api.me(signal),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      return failureCount < 2;
    },
    staleTime: 30_000,
  });
}

// The audited mutation: PATCH /users/me. On success we write the fresh user
// straight into the cache so the UI updates without a refetch round-trip.
export function useUpdateMyName() {
  const queryClient = useQueryClient();
  return useMutation<MeDto, ApiError, UpdateMyNameDto>({
    mutationFn: (input) => api.updateMyName(input),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}

// Logout clears BOTH httpOnly cookies — the web-origin mirror (via the Next route
// handler) and the API-origin session (via /auth/logout) — drops cached user state,
// then returns to /login. Neither cookie is readable from JS, so both need a request.
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await Promise.allSettled([
        fetch('/api/logout', { method: 'POST' }),
        fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }),
      ]);
    },
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
      router.refresh();
    },
  });
}
