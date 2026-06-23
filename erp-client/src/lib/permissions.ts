'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { effectivePermissions, type Permission } from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';

// ---- UI-side RBAC ----
// IMPORTANT: these helpers gate the *UI only*. They decide what a user can see,
// never what they can do — the API's PermissionsGuard is the real enforcement
// boundary and re-checks every request against the user's EFFECTIVE permissions. Hiding a button
// here is a UX nicety, not a security control. Both sides read the same
// @evertrust/shared mapping, so they can never disagree on policy.

export type CanState = {
  // True only once the user has loaded AND their role grants `perm`.
  allowed: boolean;
  // The user is still being fetched; callers can render a neutral/skeleton state
  // instead of flashing "no access" before the role is known.
  isLoading: boolean;
};

// Resolve a single permission against the current user's role. Returns both the
// decision and the loading flag so UIs can avoid a denied flash on first paint.
export function useCanState(perm: Permission): CanState {
  const { data: user, isLoading } = useMe();
  const allowed = useMemo(
    () =>
      user
        ? effectivePermissions(user.role, user.permissions).includes(perm)
        : false,
    [user, perm],
  );
  return { allowed, isLoading };
}

// Boolean-only convenience for conditional rendering: `useCan('admin:config')`.
// While the user is loading this is `false`, so prefer <Can> (which can show a
// fallback) or useCanState when the loading distinction matters.
export function useCan(perm: Permission): boolean {
  return useCanState(perm).allowed;
}

// Page guard for protected module pages. If the loaded user lacks `perm`, send
// them to /overview (the always-allowed landing zone for authenticated users).
// Returns the live state so the page can render a skeleton while loading and a
// small "no access" notice in the brief window before the redirect fires.
// This is the pattern future module pages should adopt.
export function useRequirePermission(perm: Permission): CanState {
  const router = useRouter();
  const state = useCanState(perm);

  useEffect(() => {
    if (!state.isLoading && !state.allowed) {
      router.replace('/overview');
    }
  }, [state.isLoading, state.allowed, router]);

  return state;
}
