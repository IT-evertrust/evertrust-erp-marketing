import { redirect } from 'next/navigation';

// `/dashboard` is folded into the Growth Overview. It stays as a thin permanent
// redirect so existing links/bookmarks (and the old cockpit entry point) resolve
// to the unified Overview surface rendered inside GrowthShell at /overview.
export default function DashboardPage() {
  redirect('/overview');
}
