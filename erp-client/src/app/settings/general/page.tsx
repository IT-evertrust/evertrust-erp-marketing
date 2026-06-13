'use client';

// Render on demand, never prerendered: the user's own profile is fetched in the
// browser (TanStack Query). General settings are open to every authenticated user,
// so there's no permission gate here — AppShell already handles the stale-session
// redirect, and the component shows its own loading skeleton off useMe().
import { AppShell } from '@/components/shell/app-shell';
import { GeneralSettings } from '@/components/settings/general-settings';

export default function GeneralSettingsPage() {
  return (
    <AppShell>
      <GeneralSettings />
    </AppShell>
  );
}
