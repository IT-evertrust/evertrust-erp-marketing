import { redirect } from 'next/navigation';

// Entering the app routes straight to the Growth Engine overview — the cockpit,
// not a splash page.
export default function RootPage() {
  redirect('/overview');
}
