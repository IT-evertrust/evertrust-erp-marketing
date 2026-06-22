import { redirect } from 'next/navigation';

// The public marketing landing was removed: entering the app routes straight to
// the Growth Overview so operators land on the cockpit, not a splash page. The old
// landing (and its <SessionCta>) lives in git history if it's ever needed again.
export default function RootPage() {
  redirect('/overview');
}
