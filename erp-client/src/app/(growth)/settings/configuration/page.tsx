import { redirect } from 'next/navigation';

// The standalone Configuration page was removed — connected-account management now
// lives under Settings (General). Redirect any old links/bookmarks there.
export default function ConfigurationSettingsPage() {
  redirect('/settings/general');
}
