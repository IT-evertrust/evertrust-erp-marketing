'use client';

import { use } from 'react';
// Client-rendered + dynamic: gated, browser-fetched data, nothing at build time.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { PricingWorkbench } from '@/components/pricing/pricing-workbench';
import { Skeleton } from '@/components/ui/skeleton';

// Phase 5a pricing workbench route. '/tenders' is already protected by the
// middleware; this page additionally requires pricing:read (redirects to
// /dashboard otherwise). In Next 15 route params arrive as a Promise.
export default function TenderPricingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { allowed, isLoading } = useRequirePermission('pricing:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="mx-auto h-96 max-w-6xl rounded-lg" />
      ) : allowed ? (
        <PricingWorkbench tenderId={id} />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
