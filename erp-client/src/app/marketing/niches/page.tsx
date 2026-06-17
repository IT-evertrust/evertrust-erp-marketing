import { redirect } from 'next/navigation';

// The Industry → Niche → Target catalog moved to the Insights "Sector" page.
// This route is kept as a permanent redirect so existing links/bookmarks still land.
export default function NichesPage() {
  redirect('/sector');
}
