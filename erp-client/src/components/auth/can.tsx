'use client';

import type { ReactNode } from 'react';
import type { Permission } from '@evertrust/shared';
import { useCanState } from '@/lib/permissions';

type CanProps = {
  permission: Permission;
  children: ReactNode;
  // Rendered when the user is loaded but lacks the permission. Defaults to
  // nothing, so the gated UI simply doesn't appear.
  fallback?: ReactNode;
  // While the user is still loading, render nothing by default to avoid flashing
  // either the gated content or the fallback. Pass an element to show a placeholder.
  loading?: ReactNode;
};

// Permission-gated render boundary. Shows `children` only if the current user's
// role grants `permission`. This gates the UI for clarity — the API still
// enforces the same permission on every request (see lib/permissions.ts).
export function Can({ permission, children, fallback = null, loading = null }: CanProps) {
  const { allowed, isLoading } = useCanState(permission);

  if (isLoading) return <>{loading}</>;
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
