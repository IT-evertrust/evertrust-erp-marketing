import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TenderDto, TenderStatus } from '@evertrust/shared';
import { cn } from '@/lib/utils';
import {
  STATUS_BADGE_CLASS,
  STATUS_ORDER,
  formatDate,
  formatValue,
} from '@/lib/tender-format';

// Kanban-style status board: one column per status (in lifecycle order), each
// holding the tenders currently in that status. Read-only — clicking a card
// opens the detail page where transitions happen. (Drag-to-transition is
// intentionally out of scope for M1; the detail page is the transition surface.)
export function TendersBoard({ tenders }: { tenders: TenderDto[] }) {
  const t = useTranslations('tenders');
  const byStatus = groupByStatus(tenders);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STATUS_ORDER.map((status) => {
        const items = byStatus[status];
        return (
          <section
            key={status}
            className="flex w-72 shrink-0 flex-col rounded-lg border bg-card/40"
          >
            <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                  STATUS_BADGE_CLASS[status],
                )}
              >
                {t(`status.${status}`)}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div className="flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  {t('board.empty')}
                </p>
              ) : (
                items.map((tender) => <BoardCard key={tender.id} tender={tender} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ tender }: { tender: TenderDto }) {
  const t = useTranslations('tenders');
  return (
    <Link
      href={`/tenders/${tender.id}`}
      className="block rounded-md border bg-background p-3 text-sm shadow-xs transition-colors hover:border-ring hover:bg-accent/40"
    >
      <p className="line-clamp-2 font-medium" title={tender.title}>
        {tender.title}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {tender.buyer ?? t('board.noBuyer')}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {formatValue(tender.estimatedValue, tender.currency)}
        </span>
        <span>{tender.regime ? t(`regime.${tender.regime}`) : '—'}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {t('board.due', { date: formatDate(tender.submissionDeadlineAt) })}
      </p>
    </Link>
  );
}

// Bucket tenders by status into a record keyed by every status (empty arrays for
// statuses with no tenders, so all columns always render).
function groupByStatus(tenders: TenderDto[]): Record<TenderStatus, TenderDto[]> {
  const groups = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, [] as TenderDto[]]),
  ) as Record<TenderStatus, TenderDto[]>;
  for (const tender of tenders) {
    groups[tender.status].push(tender);
  }
  return groups;
}
