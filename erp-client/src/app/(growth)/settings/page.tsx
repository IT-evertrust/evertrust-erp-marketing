import { redirect } from 'next/navigation';

// /settings has no surface of its own — General is the landing tab. Redirect so
// the sidebar/avatar "Settings" links resolve to a real page.
export default function SettingsPage() {
  redirect('/settings/general');
}
