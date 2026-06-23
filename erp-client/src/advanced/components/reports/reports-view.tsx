'use client';

import { useTranslations } from 'next-intl';
import { FileText, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToneBadge } from '@/components/rean/tone-badge';
import { ReportsTable, type ReportRow } from '@/components/rean/reports-table';

// Reports (mockup data-page="reports", ~lines 531–543): a "Generate report"
// action + a Report/Period/Created/Status table. There is NO reports backend
// yet, so the table renders empty ("no reports yet") and "Generate report" is a
// disabled coming-soon affordance — no fabricated rows.
export function ReportsView() {
  const t = useTranslations('reports');

  // No reports backend yet — the list is empty by design.
  const rows: ReportRow[] = [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex items-center gap-2">
            <ToneBadge tone="muted">{t('comingSoon')}</ToneBadge>
            <Button disabled title={t('generateHint')}>
              <Plus />
              {t('generate')}
            </Button>
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={<FileText />}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        </Card>
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
    </div>
  );
}
