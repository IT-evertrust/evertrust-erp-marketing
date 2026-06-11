'use client';

// Client-rendered + dynamic: gated, browser-fetched data, nothing at build time.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { SuppliersView } from '@/components/registry/suppliers-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function SuppliersPage() {
  const { allowed, isLoading } = useRequirePermission('suppliers:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <SuppliersView />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
