'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, CalendarDays, Mic, Search } from 'lucide-react';
import { useCalendarFreeSlots, useCalendarUpcoming } from '@/hooks/use-meetings';
import { AccountBar } from '@/components/rean/account-bar';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { Calendar as CalendarView } from '@/components/activate/calendar/calendar';
import {
  DEFAULT_TIME_ZONE,
  addDaysToDateKey,
  startOfWorkWeekKey,
  zonedTimeToUtcDate,
} from '@/components/activate/calendar/time-grid';

const WORK_WEEK_DAYS = 7;

type ActivateTab = 'book' | 'research' | 'after';

export function ActivateView() {
  const t = useTranslations('activate');

  const [tab, setTab] = useState<ActivateTab>('book');

  const calendarWeekStartKey = useMemo(
    () => startOfWorkWeekKey(new Date(), DEFAULT_TIME_ZONE),
    [],
  );

  // The AccountBar shows the calendar connection + a snapshot count. It fetches a
  // fixed buffered week window for that summary; the <Calendar/> grid owns its own
  // view-aware fetch independently (React Query dedupes by key). The fetch window is
  // zone-agnostic; timeZone here only tags the request.
  const accountRange = useMemo(() => {
    const timeMin = zonedTimeToUtcDate(
      addDaysToDateKey(calendarWeekStartKey, -1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );

    const timeMax = zonedTimeToUtcDate(
      addDaysToDateKey(calendarWeekStartKey, WORK_WEEK_DAYS + 1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );

    return {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: DEFAULT_TIME_ZONE,
    };
  }, [calendarWeekStartKey]);

  const upcoming = useCalendarUpcoming(accountRange);

  const freeSlots = useCalendarFreeSlots({
    ...accountRange,
    durationMinutes: 30,
  });

  const configured = Boolean(upcoming.data?.configured || freeSlots.data?.configured);

  const email = upcoming.data?.account?.email ?? null;

  const service = (
    <>
      <Calendar className="size-3.5" />
      {configured && email ? t('account.connected', { email }) : t('account.service')}
    </>
  );

  const stats =
    upcoming.isLoading || freeSlots.isLoading
      ? t('account.statsLoading')
      : upcoming.isError || freeSlots.isError
        ? t('account.statsError')
        : t('account.stats', {
            meetings: upcoming.data?.events.length ?? 0,
            slots: freeSlots.data?.slots.length ?? 0,
          });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />

      <AccountBar service={service} mailboxes={[]} connected={configured} stats={stats} />

      <SegmentedTabs
        value={tab}
        onValueChange={(v) => setTab(v as ActivateTab)}
        tabs={[
          {
            value: 'book',
            label: t('tabs.book'),
            icon: <CalendarDays className="size-4" />,
          },
          {
            value: 'research',
            label: t('tabs.research'),
            icon: <Search className="size-4" />,
          },
          {
            value: 'after',
            label: t('tabs.after'),
            icon: <Mic className="size-4" />,
          },
        ]}
      />

      {tab === 'book' ? (
        <CalendarView />
      ) : tab === 'research' ? (
        <EmptyState
          icon={<Search />}
          title={t('research.comingSoon')}
          description={t('research.comingSoonBody')}
        />
      ) : (
        <EmptyState
          icon={<Mic />}
          title={t('after.comingSoon')}
          description={t('after.comingSoonBody')}
        />
      )}
    </div>
  );
}
