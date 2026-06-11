'use client';

// Render on demand, never prerendered: protected per-tenant data fetched in the
// browser (TanStack Query). Middleware guards `/users/*`; useRequirePermission is
// the defence-in-depth second layer. Viewing a profile is users:manage, the same
// gate as the Users directory it's reached from.
import { use } from 'react';
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { ProfileView } from '@/components/users/profile-view';
import { Skeleton } from '@/components/ui/skeleton';

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 15: route params arrive as a Promise; unwrap with React.use().
  const { id } = use(params);
  const { allowed, isLoading } = useRequirePermission('users:manage');

  return (
    <AppShell>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : allowed ? (
        <ProfileView userId={id} />
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      )}
    </AppShell>
  );
}
