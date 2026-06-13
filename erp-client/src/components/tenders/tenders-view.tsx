'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  AlarmClock,
  FileSearch,
  LayoutGrid,
  ListChecks,
  Plus,
  Send,
  Table2,
  Trophy,
} from 'lucide-react';
import {
  TenderStatus,
  computeDeadlineRisk,
  type TenderDto,
  type TenderStatus as TenderStatusT,
} from '@evertrust/shared';
import { useTenders } from '@/hooks/use-tenders';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/common/page-header';
import { StatTile } from '@/components/common/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { STATUS_ORDER } from '@/lib/tender-format';
import { TendersTable } from './tenders-table';
import { TendersBoard } from './tenders-board';

// "All" sentinel for the status <Select> — Radix Select items can't have an empty
// value, so we use a sentinel and map it back to "no filter".
const ALL = '__all__';

// Statuses that count as "open" pipeline work (i.e. not yet submitted/closed).
const OPEN_STATUSES: readonly TenderStatusT[] = [
  'NOT_STARTED',
  'PIC_PRICING',
  'CUSTOMER_PRICING',
  'DOCUMENTS',
];

// Pipeline KPIs derived ENTIRELY from the unfiltered tenders list the page already
// fetches — never a new API call. At-risk reuses the shared computeDeadlineRisk
// rule (same authority the API + n8n use) so the count can't drift from the badge.
function summarize(tenders: TenderDto[]) {
  const now = new Date();
  let open = 0;
  let submitted = 0;
  let awarded = 0;
  let atRisk = 0;
  for (const t of tenders) {
    if (OPEN_STATUSES.includes(t.status)) open += 1;
    if (t.status === 'SUBMITTED') submitted += 1;
    if (t.status === 'AWARDED') awarded += 1;
    if (computeDeadlineRisk(t.submissionDeadlineAt, now, t.status).atRisk) {
      atRisk += 1;
    }
  }
  return { total: tenders.length, open, submitted, awarded, atRisk };
}

// Tenders module home: a masthead + a pipeline stat row, then a status filter and
// a table/board toggle over the SAME filtered data. The status filter is applied
// server-side via the query so both views show the same rows. The stat row reads
// the UNFILTERED list (its own cached query) so the pipeline summary stays whole
// even when the table below is filtered down to one status.
export function TendersView() {
  const t = useTranslations('tenders');
  const [status, setStatus] = useState<TenderStatusT | undefined>(undefined);
  const { data, isLoading, isError, error } = useTenders(
    status ? { status } : undefined,
  );

  // Unfiltered list, only for the pipeline stat row. Shares the tenders cache with
  // the (unfiltered) table state, so when no filter is active there's no extra fetch.
  const all = useTenders();
  const stats = all.data ? summarize(all.data) : null;
  const statsReady = !all.isLoading && !all.isError && stats !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          <Can permission="tenders:write">
            <Button asChild>
              <Link href="/tenders/new">
                <Plus />
                {t('list.newTender')}
              </Link>
            </Button>
          </Can>
        }
      />

      {/* Pipeline summary computed from the unfiltered tenders list. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {all.isLoading || !statsReady ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[6.5rem] w-full rounded-lg" />
          ))
        ) : (
          <>
            <StatTile
              label={t('list.stats.total')}
              value={stats.total}
              icon={<FileSearch className="size-4" />}
            />
            <StatTile
              label={t('list.stats.open')}
              value={stats.open}
              hint={t('list.stats.openHint')}
              accent="bg-sky-400"
              icon={<ListChecks className="size-4" />}
            />
            <StatTile
              label={t('list.stats.submitted')}
              value={stats.submitted}
              hint={t('list.stats.submittedHint')}
              accent="bg-indigo-400"
              icon={<Send className="size-4" />}
            />
            <StatTile
              label={t('list.stats.awarded')}
              value={stats.awarded}
              hint={t('list.stats.awardedHint')}
              accent="bg-emerald-400"
              icon={<Trophy className="size-4" />}
            />
            <StatTile
              label={t('list.stats.atRisk')}
              value={stats.atRisk}
              hint={t('list.stats.atRiskHint')}
              accent={stats.atRisk > 0 ? 'bg-orange-400' : 'bg-emerald-400'}
              icon={<AlarmClock className="size-4" />}
            />
          </>
        )}
      </div>

      <Tabs defaultValue="table" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select
            value={status ?? ALL}
            onValueChange={(v) =>
              setStatus(v === ALL ? undefined : TenderStatus.parse(v))
            }
          >
            <SelectTrigger className="w-48" aria-label={t('list.filterByStatus')}>
              <SelectValue placeholder={t('list.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('list.allStatuses')}</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <TabsList>
            <TabsTrigger value="table">
              <Table2 />
              {t('list.tabTable')}
            </TabsTrigger>
            <TabsTrigger value="board">
              <LayoutGrid />
              {t('list.tabBoard')}
            </TabsTrigger>
          </TabsList>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : isError ? (
          <EmptyState
            icon={<FileSearch />}
            title={t('list.loadError')}
            description={error.message}
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={<FileSearch />}
            title={
              status
                ? t('list.emptyFilteredTitle', { status: t(`status.${status}`) })
                : t('list.emptyTitle')
            }
            description={
              status
                ? t('list.emptyFilteredDescription')
                : t('list.emptyDescription')
            }
            action={
              status ? (
                <Button variant="outline" size="sm" onClick={() => setStatus(undefined)}>
                  {t('list.clearFilter')}
                </Button>
              ) : (
                <Can permission="tenders:write">
                  <Button asChild size="sm">
                    <Link href="/tenders/new">
                      <Plus />
                      {t('list.newTender')}
                    </Link>
                  </Button>
                </Can>
              )
            }
          />
        ) : (
          <>
            <TabsContent value="table">
              <TendersTable tenders={data} />
            </TabsContent>
            <TabsContent value="board">
              <TendersBoard tenders={data} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
