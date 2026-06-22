'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser (TanStack Query). Middleware guards the route; useRequirePermission is
// the defence-in-depth second layer. Managing users is users:manage (Super Admin).
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { UsersView } from '@/components/users/users-view';
import { Skeleton } from '@/components/ui/skeleton';

// GrowthShell chrome comes from the (growth) route-group layout; this page renders
// only its body content.
export default function UsersPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('users:manage');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!allowed)
    return <p className="text-sm text-muted-foreground">{t('redirecting')}</p>;
  return <UsersView />;
}
