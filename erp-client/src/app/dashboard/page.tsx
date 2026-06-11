import { DashboardView } from '@/components/dashboard/dashboard-view';

// Render on demand, never prerendered: the dashboard is a protected, per-user
// surface, so it should be dynamic rather than a static asset. The view itself is
// client-rendered (DashboardView uses TanStack Query), so user data is fetched in
// the browser and nothing touches the API at build time. Middleware guards access;
// this is a defence-in-depth second layer.
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return <DashboardView />;
}
