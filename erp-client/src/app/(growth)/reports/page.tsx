'use client';

// Render on demand, never prerendered: a gated, per-tenant surface. Middleware
// guards the route; useRequirePermission is the defence-in-depth second layer.
// Insights → Reports — the table + "Generate report" affordance are an honest
// empty/coming-soon state until a reports backend exists.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { ReportsView } from '@/components/reports/reports-view';
import { Skeleton } from '@/components/ui/skeleton';

// GrowthShell chrome comes from the (growth) route-group layout; this page renders
// only its body content.
export default function ReportsPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!allowed)
    return <p className="text-sm text-muted-foreground">{t('redirecting')}</p>;
  return <ReportsView />;
}
