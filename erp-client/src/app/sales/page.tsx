'use client';

import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { SalesView } from '@/components/sales/sales-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function SalesPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <SalesView />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
