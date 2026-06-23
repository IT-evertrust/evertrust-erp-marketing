'use client';

// Render on demand, never prerendered: a gated, per-tenant surface. Middleware
// guards the route; useRequirePermission is the defence-in-depth second layer.
// Insights → Reports — the table + "Generate report" affordance are an honest
// empty/coming-soon state until a reports backend exists.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/advanced/components/shell/app-shell';
import { ReportsView } from '@/advanced/components/reports/reports-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReportsPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <ReportsView />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
