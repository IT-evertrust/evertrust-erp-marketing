'use client';

// Render on demand, never prerendered: a gated, per-tenant surface. Middleware
// guards the route; useRequirePermission is the defence-in-depth second layer.
// Step 3 of R.E.A.N. — the Activate redesign (Google Calendar booking, research,
// after-sales analysis); see components/activate/activate-view.tsx.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { ActivateView } from '@/components/activate/activate-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function ActivatePage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <ActivateView />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
