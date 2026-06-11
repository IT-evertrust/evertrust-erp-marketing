'use client';

import { use } from 'react';
// Client-rendered + dynamic: gated, browser-fetched data, nothing at build time.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { TenderDetail } from '@/components/tenders/tender-detail';
import { Skeleton } from '@/components/ui/skeleton';

// In Next 15 route params arrive as a Promise; unwrap with React.use().
export default function TenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { allowed, isLoading } = useRequirePermission('tenders:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="mx-auto h-96 max-w-4xl rounded-lg" />
      ) : allowed ? (
        <TenderDetail id={id} />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
