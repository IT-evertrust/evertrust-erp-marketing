import { ReplyDraftsView } from '@/components/growth/reply-drafts-view';

// Engage — step 2 of R.E.A.N. Renders the LIVE reply-triage (real Gmail data via
// the engage backend) inside the unified GrowthShell (provided by the (growth)
// layout — do NOT add AppShell here). Kobe's mock EngagePage is retired; the live
// view lives in components/growth/reply-drafts-view.tsx.
export const dynamic = 'force-dynamic';

export default function EngageRoutePage() {
  return <ReplyDraftsView />;
}
