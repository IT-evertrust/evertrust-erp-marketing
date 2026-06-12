'use client';

import { use } from 'react';
// Client-rendered + dynamic: gated, browser-fetched data, nothing at build time.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { CampaignDetail } from '@/components/growth/campaign-detail';
import { Skeleton } from '@/components/ui/skeleton';

// In Next 15 route params arrive as a Promise; unwrap with React.use().
export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="mx-auto h-96 max-w-5xl rounded-lg" />
      ) : allowed ? (
        <CampaignDetail id={campaignId} />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
