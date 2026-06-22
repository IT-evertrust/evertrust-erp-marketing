import { redirect } from 'next/navigation';

// Marketing is folded into Reach (step 1 of R.E.A.N.). Per-campaign detail pages
// are kept as a thin permanent redirect so existing links/bookmarks still land on
// Reach. The old <CampaignDetail> lives in components/growth/ if needed.
export default function CampaignDetailPage() {
  redirect('/reach');
}
