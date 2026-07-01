'use client';

import { useRouter } from 'next/navigation';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  LoginResponseDto,
  MeDto,
  UpdateMyNameDto,
  UpdateMySenderIdentityDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { getLandingPath } from '@/lib/preferences';
import { queryKeys } from '@/lib/query-keys';

// Both Google login paths return the same { accessToken, user }. After the API call
// we mirror the token to our own route handler so a web-origin httpOnly cookie exists
// for middleware gating (the API's cookie is cross-origin), then return the result.
async function mirrorSession(result: LoginResponseDto): Promise<LoginResponseDto> {
  await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: result.accessToken }),
  });
  return result;
}

// Shared success handler for both Google flows: seed the user cache so the shell
// renders without a round-trip, then navigate to the user's chosen landing page
// (Settings → General → Display; defaults to /dashboard) and refresh so server
// components re-read the new cookie.
function onLoginSuccess(
  queryClient: QueryClient,
  router: ReturnType<typeof useRouter>,
  result: LoginResponseDto,
): void {
  queryClient.setQueryData(queryKeys.me, result.user);
  router.replace(getLandingPath());
  router.refresh();
}

// Google login via the ID-token flow (the GIS-rendered button's credential callback).
// The API verifies the ID token and resolves/auto-provisions the user + org.
export function useGoogleLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation<LoginResponseDto, ApiError, string>({
    mutationFn: (idToken) => api.googleLogin(idToken).then(mirrorSession),
    onSuccess: (result) => onLoginSuccess(queryClient, router, result),
  });
}

// Google login via the OAuth 2.0 authorization-code flow (the custom GIS
// `initCodeClient` popup button). The API exchanges the short-lived `code`
// server-side for an ID token, then resolves/auto-provisions exactly as the
// ID-token path does — identical success flow, identical 401/403/503 contract.
export function useGoogleCodeLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation<LoginResponseDto, ApiError, string>({
    mutationFn: (code) => api.googleCodeLogin(code).then(mirrorSession),
    onSuccess: (result) => onLoginSuccess(queryClient, router, result),
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

// The signature-image endpoints return only the resolved URL, so we invalidate the
// `me` query (rather than seed it) to pull the freshly-stored signatureImageUrl.
type SignatureImageResult = { signatureImageUrl: string | null };

// PER-USER sender identity: PATCH the current user's own sender name + signature text.
// The API returns the fresh MeDto, so seed the cache directly (no refetch).
export function useUpdateMySenderIdentity() {
  const queryClient = useQueryClient();
  return useMutation<MeDto, ApiError, UpdateMySenderIdentityDto>({
    mutationFn: (input) => api.users.updateMySenderIdentity(input),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}

// Upload the current user's signature image file (multipart → POST).
export function useUploadMySignatureImage() {
  const queryClient = useQueryClient();
  return useMutation<SignatureImageResult, ApiError, File>({
    mutationFn: (file) => api.users.uploadMySignatureImage(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

// Point the current user's signature image at a pasted URL / Drive share link.
export function useSetMySignatureImageUrl() {
  const queryClient = useQueryClient();
  return useMutation<SignatureImageResult, ApiError, string>({
    mutationFn: (url) => api.users.setMySignatureImageUrl(url),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

// Clear the current user's signature image (DELETE).
export function useClearMySignatureImage() {
  const queryClient = useQueryClient();
  return useMutation<SignatureImageResult, ApiError, void>({
    mutationFn: () => api.users.clearMySignatureImage(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

// Logout clears the httpOnly cookie via the Next route handler (the cookie is not
// readable from JS), drops cached user state, then returns to /login.
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await fetch('/api/logout', { method: 'POST' });
    },
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
      router.refresh();
    },
  });
}
