'use client';

// Render on demand, never prerendered: the user's own profile is fetched in the
// browser (TanStack Query). General settings are open to every authenticated user,
// so there's no permission gate here — the component shows its own loading skeleton
// off useMe(). GrowthShell chrome comes from the (growth) route-group layout.
import { GeneralSettings } from '@/components/settings/general-settings';

export default function GeneralSettingsPage() {
  return <GeneralSettings />;
}
