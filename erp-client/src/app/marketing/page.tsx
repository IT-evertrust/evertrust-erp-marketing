'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser (TanStack Query). Middleware guards the route; useRequirePermission is
// the defence-in-depth second layer.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { MarketingView } from '@/components/marketing/marketing-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function MarketingPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <MarketingView />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
