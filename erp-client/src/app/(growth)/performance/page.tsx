'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser. Middleware guards the route; useRequirePermission is the second layer.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AnalyticsView } from '@/components/performance/analytics-view';
import { Skeleton } from '@/components/ui/skeleton';

// GrowthShell chrome comes from the (growth) route-group layout; this page renders
// only its body content.
export default function PerformancePage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('performance:read');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!allowed)
    return <p className="text-sm text-muted-foreground">{t('redirecting')}</p>;
  return <AnalyticsView />;
}
