'use client';

// Render on demand, never prerendered: workspace automation/integration config is
// admin-only per-tenant data. Middleware guards the route; useRequirePermission is
// the defence-in-depth second layer (admin:config — SUPER_ADMIN + ADMIN).
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { ConfigurationSettings } from '@/components/settings/configuration-settings';
import { Skeleton } from '@/components/ui/skeleton';

// GrowthShell chrome comes from the (growth) route-group layout; this page renders
// only its body content.
export default function ConfigurationSettingsPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('admin:config');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!allowed)
    return <p className="text-sm text-muted-foreground">{t('redirecting')}</p>;
  return <ConfigurationSettings />;
}
