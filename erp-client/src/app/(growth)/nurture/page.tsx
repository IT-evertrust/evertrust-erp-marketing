import { NurtureUI } from '@/modules/(growth)/nurture/ui/nurture-page';

// Render on demand, never prerendered: a protected, per-user surface. The view is
// client-rendered (TanStack Query), so data is fetched in the browser; middleware
// guards access and useRequirePermission is the defence-in-depth second layer.
export const dynamic = 'force-dynamic';

export default function NurtureRoutePage() {
  return <NurtureUI />;
}
