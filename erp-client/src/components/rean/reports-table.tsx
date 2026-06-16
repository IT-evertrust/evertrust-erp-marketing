import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToneBadge, type ToneName } from '@/components/rean/tone-badge';
import { cn } from '@/lib/utils';

export type ReportRow = {
  // Stable row key.
  id: string;
  // Report name (rendered bold).
  name: ReactNode;
  // Reporting period (e.g. "Apr–Jun").
  period: ReactNode;
  // Created date (e.g. "12 Jun").
  created: ReactNode;
  // Status label shown as a pill badge.
  status: ReactNode;
  // Badge tone for the status pill. Defaults to emerald ("Ready").
  statusTone?: ToneName;
  // Optional trailing action (e.g. a "PDF" download button).
  action?: ReactNode;
};

// The Reports table (mockup lines 534–542): Report / Period / Created / Status
// columns + an optional trailing action cell, with the prototype's uppercase
// 11px table headers. Presentational — pass rows + per-row actions.
export function ReportsTable({
  rows,
  labels,
  className,
}: {
  rows: ReportRow[];
  // Column header labels (translatable). Defaults to English.
  labels?: {
    report?: string;
    period?: string;
    created?: string;
    status?: string;
  };
  className?: string;
}) {
  const l = {
    report: labels?.report ?? 'Report',
    period: labels?.period ?? 'Period',
    created: labels?.created ?? 'Created',
    status: labels?.status ?? 'Status',
  };
  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[11px] uppercase tracking-wider">
              {l.report}
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">
              {l.period}
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">
              {l.created}
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">
              {l.status}
            </TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-semibold">{r.name}</TableCell>
              <TableCell className="text-muted-foreground">{r.period}</TableCell>
              <TableCell className="text-muted-foreground">
                {r.created}
              </TableCell>
              <TableCell>
                <ToneBadge tone={r.statusTone ?? 'emerald'}>
                  {r.status}
                </ToneBadge>
              </TableCell>
              <TableCell className="text-right">{r.action}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
