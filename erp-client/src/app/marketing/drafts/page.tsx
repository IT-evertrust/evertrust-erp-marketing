import { redirect } from 'next/navigation';

// Reply drafts moved into Engage (step 2 of R.E.A.N.). Kept as a thin permanent
// redirect so existing links/bookmarks still land. The old <ReplyDraftsView> lives
// in components/growth/ if needed.
export default function ReplyDraftsPage() {
  redirect('/engage');
}
