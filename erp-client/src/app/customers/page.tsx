'use client';

// Client-rendered + dynamic: gated, browser-fetched data, nothing at build time.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { CustomersView } from '@/components/registry/customers-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function CustomersPage() {
  const t = useTranslations('customers');
  const { allowed, isLoading } = useRequirePermission('customers:read');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <CustomersView />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
