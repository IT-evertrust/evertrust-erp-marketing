import { redirect } from 'next/navigation';

// Marketing is folded into Reach (step 1 of R.E.A.N.). This route is kept as a
// thin permanent redirect so existing links/bookmarks still land on the unified
// Reach surface. The old <MarketingView> lives in components/marketing/ if needed.
export default function MarketingPage() {
  redirect('/reach');
}
