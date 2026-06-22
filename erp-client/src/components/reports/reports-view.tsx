'use client';

import { useTranslations } from 'next-intl';
import { FileText, Plus } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { ToneBadge } from '@/components/rean/tone-badge';
import { ReportsTable, type ReportRow } from '@/components/rean/reports-table';

// Reports (mockup data-page="reports", ~lines 531–543): a "Generate report"
// action + a Report/Period/Created/Status table. There is NO reports backend
// yet, so the table renders empty ("no reports yet") and "Generate report" is a
// disabled coming-soon affordance — no fabricated rows.
//
// Restyled to Kobe's minimalist GrowthShell language: a `<main>` masthead (title
// + uppercase eyebrow) over token-based card surfaces. Colours are theme tokens
// only (dark-mode safe); all i18n keys are preserved.
export function ReportsView() {
  const t = useTranslations('reports');

  // No reports backend yet — the list is empty by design.
  const rows: ReportRow[] = [];

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        <ToneBadge tone="muted">{t('comingSoon')}</ToneBadge>
        <Button disabled title={t('generateHint')}>
          <Plus />
          {t('generate')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="overflow-hidden rounded-[10px] border border-sidebar-border bg-card">
          <EmptyState
            icon={<FileText />}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        </div>
      ) : (
        <ReportsTable
          rows={rows}
          labels={{
            report: t('table.report'),
            period: t('table.period'),
            created: t('table.created'),
            status: t('table.status'),
          }}
        />
      )}
    </main>
  );
}
