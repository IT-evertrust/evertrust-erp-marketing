'use client';

// Render on demand, never prerendered: workspace automation/integration config is
// admin-only per-tenant data. Middleware guards the route; useRequirePermission is
// the defence-in-depth second layer (admin:config — SUPER_ADMIN + ADMIN).
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/advanced/components/shell/app-shell';
import { ConfigurationSettings } from '@/advanced/components/settings/configuration-settings';
import { Skeleton } from '@/components/ui/skeleton';

export default function ConfigurationSettingsPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('admin:config');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <ConfigurationSettings />
      ) : (
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      )}
    </AppShell>
  );
}
