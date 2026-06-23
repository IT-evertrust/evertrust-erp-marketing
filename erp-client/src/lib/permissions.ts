'use client';

import { type Permission } from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';

// ---- UI-side RBAC: DISABLED (single-team internal app) ----
// Authorization is turned off to match the backend PermissionsGuard: this is the
// marketing department's own ERP for ~4 trusted colleagues, so any signed-in user
// can see and do everything. These helpers keep their old signatures (so every
// caller keeps working) but now grant every permission to any authenticated user.
// AUTHENTICATION still applies — `useMe()` only resolves a user for a valid Google
// session. Restore the role-based body here to re-enable UI gating.

export type CanState = {
  // Allowed once the user has loaded (every authenticated user is allowed).
  allowed: boolean;
  // The user is still being fetched; callers can render a neutral/skeleton state.
  isLoading: boolean;
};

// Any authenticated user is allowed every permission. `perm` is accepted for
// signature compatibility but no longer consulted.
export function useCanState(_perm: Permission): CanState {
  const { data: user, isLoading } = useMe();
  return { allowed: !!user, isLoading };
}

// Boolean-only convenience for conditional rendering: `useCan('admin:config')`.
export function useCan(perm: Permission): boolean {
  return useCanState(perm).allowed;
}

// Page guard kept for signature compatibility. With authorization disabled it
// never redirects — any authenticated user may view any module page (the route is
// still auth-gated by the middleware / JwtAuthGuard).
export function useRequirePermission(perm: Permission): CanState {
  return useCanState(perm);
}
