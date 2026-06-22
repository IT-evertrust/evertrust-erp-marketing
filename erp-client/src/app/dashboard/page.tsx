import { GrowthShell } from '@/modules/(growth)/shell';
import { OverviewUI } from '@/modules/(growth)/overview/ui/overview-page';

// Render on demand, never prerendered: the dashboard is a protected, per-user
// surface, so it should be dynamic rather than a static asset. The view itself is
// client-rendered (TanStack Query), so user data is fetched in the browser and
// nothing touches the API at build time. Middleware guards access; this is a
// defence-in-depth second layer.
//
// `/dashboard` now renders the Growth Overview (the rework UI). It is OUTSIDE the
// (growth) route group, so it must supply <GrowthShell> itself — the same wrapper
// (growth)/layout.tsx provides to /overview. (The old <DashboardView/> brought its
// own AppShell and is kept in components/dashboard/ if needed.)
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <GrowthShell>
      <OverviewUI />
    </GrowthShell>
  );
}
