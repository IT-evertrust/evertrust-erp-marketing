'use client';

// Client-rendered + dynamic: gated, per-tenant data fetched in the browser.
// "Sector" is the Insights home for the org's Industry → Niche → Target catalog —
// the same management surface the (now-redirected) /marketing/niches route used.
import { useTranslations } from 'next-intl';
import { useRequirePermission } from '@/lib/permissions';
import { NichesView } from '@/components/growth/niches-view';
import { Skeleton } from '@/components/ui/skeleton';

// GrowthShell chrome comes from the (growth) route-group layout; this page renders
// only its body content.
export default function SectorPage() {
  const t = useTranslations('common');
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!allowed)
    return <p className="text-sm text-muted-foreground">{t('redirecting')}</p>;
  return <NichesView />;
}
