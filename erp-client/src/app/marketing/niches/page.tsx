'use client';

// Client-rendered + dynamic: gated, per-tenant data fetched in the browser.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { NichesView } from '@/components/growth/niches-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function NichesPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <NichesView />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
