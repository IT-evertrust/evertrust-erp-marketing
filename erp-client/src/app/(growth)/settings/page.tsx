import { SettingsUI } from '@/modules/(growth)/settings/ui/settings-page';

// Render on demand, never prerendered: a protected, per-user surface, consistent with
// the other growth routes.
export const dynamic = 'force-dynamic';

export default function SettingsRoutePage() {
  return <SettingsUI />;
}
