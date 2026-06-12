'use client';

// Client-rendered + dynamic: gated, per-tenant data fetched in the browser.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { ReplyDraftsView } from '@/components/growth/reply-drafts-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReplyDraftsPage() {
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <ReplyDraftsView />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
