'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser (TanStack Query). Middleware guards `/users/*`; useRequirePermission is
// the defence-in-depth second layer. Viewing a profile is users:manage, the same
// gate as the Users directory it's reached from.
import { use } from 'react';
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { ProfileView } from '@/components/users/profile-view';
import { Skeleton } from '@/components/ui/skeleton';

// GrowthShell chrome comes from the (growth) route-group layout; this page renders
// only its body content.
export default function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 15: route params arrive as a Promise; unwrap with React.use().
  const { id } = use(params);
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('users:manage');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!allowed)
    return <p className="text-sm text-muted-foreground">{t('redirecting')}</p>;
  return <ProfileView userId={id} />;
}
