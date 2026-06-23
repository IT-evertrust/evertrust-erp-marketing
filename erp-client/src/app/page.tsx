import { redirect } from 'next/navigation';

// Entering the app routes straight to the Growth Engine overview — the cockpit,
// not a splash page. The R-E-A-N funnel (Overview → Reach → Engage → Activate →
// Nurture) is the product; the advanced dashboard lives at /dashboard if needed.
export default function RootPage() {
  redirect('/overview');
}
