'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser (TanStack Query), so nothing touches the API at build time. Middleware
// guards the route; useRequirePermission is the defence-in-depth second layer.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { TendersView } from '@/components/tenders/tenders-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function TendersPage() {
  const { allowed, isLoading } = useRequirePermission('tenders:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <TendersView />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
