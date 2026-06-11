import Link from 'next/link';
import type { TenderDto } from '@evertrust/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from './status-badge';
import { REGIME_LABEL, formatDate, formatValue } from '@/lib/tender-format';

// Dense tabular view of tenders. Each row links to the tender's detail page.
// Columns: title, status, buyer, regime, value, submission deadline.
export function TendersTable({ tenders }: { tenders: TenderDto[] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Buyer</TableHead>
            <TableHead>Regime</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Submission</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenders.map((tender) => (
            <TableRow key={tender.id} className="cursor-pointer">
              <TableCell className="max-w-[22rem] font-medium">
                <Link
                  href={`/tenders/${tender.id}`}
                  className="block truncate hover:underline"
                  title={tender.title}
                >
                  {tender.title}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {tender.vergabeId} · {tender.source}
                </span>
              </TableCell>
              <TableCell>
                <StatusBadge status={tender.status} />
              </TableCell>
              <TableCell className="max-w-[12rem] truncate text-muted-foreground">
                {tender.buyer ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {tender.regime ? REGIME_LABEL[tender.regime] : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatValue(tender.estimatedValue, tender.currency)}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {formatDate(tender.submissionDeadlineAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
