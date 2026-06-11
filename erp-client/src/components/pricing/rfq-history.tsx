'use client';

import type { RfqDto } from '@evertrust/shared';
import { useTenderRfqs } from '@/hooks/use-rfq';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';

// Dispatch outcome badge: DISPATCHED (the Hermes webhook accepted it) is emerald,
// FAILED (couldn't reach it) is rose — matching the pricing R/Y/G palette.
const RFQ_STATUS_CLASS: Record<RfqDto['status'], string> = {
  DISPATCHED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  FAILED: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// The RFQs dispatched for a tender (newest-first). Each row shows the outcome,
// what was asked (supplier + line counts), an optional note (or the failure detail)
// and when. Replies themselves land as price observations on the lines, not here.
export function RfqHistory({ tenderId }: { tenderId: string }) {
  const rfqs = useTenderRfqs(tenderId);

  if (rfqs.isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (!rfqs.data || rfqs.data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No RFQs sent yet. Use “Request quotes” to ask suppliers for prices.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rfqs.data.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
          <Badge
            variant="outline"
            className={cn('shrink-0', RFQ_STATUS_CLASS[r.status])}
          >
            {r.status}
          </Badge>
          <div className="min-w-0">
            <div className="truncate">
              {plural(r.supplierIds.length, 'supplier')} ·{' '}
              {plural(r.lineItemIds.length, 'line')}
            </div>
            {r.note ? (
              <div className="truncate text-xs text-muted-foreground">
                {r.note}
              </div>
            ) : r.status === 'FAILED' && r.detail ? (
              <div className="truncate text-xs text-rose-400/80">{r.detail}</div>
            ) : null}
          </div>
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {formatDateTime(r.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
