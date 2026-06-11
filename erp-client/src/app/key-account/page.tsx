'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser. Middleware guards the route; useRequirePermission is the second layer.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { KeyAccountView } from '@/components/key-account/key-account-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function KeyAccountPage() {
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <KeyAccountView />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
