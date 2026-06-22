import { redirect } from 'next/navigation';

// Marketing is folded into Reach (step 1 of R.E.A.N.). This route is kept as a
// thin permanent redirect so existing links/bookmarks still land on Reach.
export default function NichesPage() {
  redirect('/reach');
}
