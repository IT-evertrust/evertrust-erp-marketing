import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
import { formatDate, formatValue } from '@/lib/tender-format';

// Dense tabular view of tenders. Each row links to the tender's detail page.
// Columns: title, status, buyer, regime, value, submission deadline.
export function TendersTable({ tenders }: { tenders: TenderDto[] }) {
  const t = useTranslations('tenders');
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('table.title')}</TableHead>
            <TableHead>{t('table.status')}</TableHead>
            <TableHead>{t('table.buyer')}</TableHead>
            <TableHead>{t('table.regime')}</TableHead>
            <TableHead className="text-right">{t('table.value')}</TableHead>
            <TableHead>{t('table.submission')}</TableHead>
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
                {tender.regime ? t(`regime.${tender.regime}`) : '—'}
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
