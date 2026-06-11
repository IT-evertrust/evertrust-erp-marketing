'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser (TanStack Query). Middleware guards the route; useRequirePermission is
// the defence-in-depth second layer. Managing users is users:manage (Super Admin).
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { UsersView } from '@/components/users/users-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function UsersPage() {
  const { allowed, isLoading } = useRequirePermission('users:manage');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <UsersView />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
