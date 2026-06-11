'use client';

import { useMarketingReport } from '@/hooks/use-arsenal';
import { useMarketingDrafts } from '@/hooks/use-marketing';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// The persistent funnel KPI strip above the Marketing tabs (mockup parity). Leads →
// Emails → Replies → Meetings are REAL arsenal_runs counts (null shows "—" until n8n
// reports them via the run callback); "Drafts to review" is the live RAG-draft queue.
export function MarketingFunnelBar() {
  const report = useMarketingReport('week', null);
  const f = report.data?.funnel;
  const loading = report.isLoading;
  const draftsQ = useMarketingDrafts();
  const draftCount = draftsQ.data?.count ?? null;

  const cells: { label: string; value: number | null; accent?: boolean }[] = [
    { label: 'Leads', value: f?.leadsFound ?? null },
    { label: 'Emails', value: f?.emailsSent ?? null },
    { label: 'Replies', value: f?.repliesHandled ?? null },
    { label: 'Meetings', value: f?.meetingsBooked ?? null },
    { label: 'Drafts to review', value: draftCount, accent: true },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => {
        const lit = c.accent && (c.value ?? 0) > 0;
        return (
          <div
            key={c.label}
            className={cn(
              'rounded-xl border bg-card px-3.5 py-2.5',
              lit && 'border-amber-500/40 bg-amber-500/5',
            )}
          >
            <div
              className={cn(
                'text-lg font-bold tabular-nums',
                lit && 'text-amber-600 dark:text-amber-400',
              )}
            >
              {loading ? (
                <Skeleton className="h-6 w-8" />
              ) : c.value === null ? (
                <span className="text-muted-foreground/50">—</span>
              ) : (
                c.value.toLocaleString()
              )}
            </div>
            <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground/70">
              {c.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
