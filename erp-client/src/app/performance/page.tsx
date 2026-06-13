'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser. Middleware guards the route; useRequirePermission is the second layer.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { PerformanceView } from '@/components/performance/performance-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function PerformancePage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('performance:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <PerformanceView />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
