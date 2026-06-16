'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  Check,
  Lock,
  Mic,
  Search,
} from 'lucide-react';
import type { MeetingDto } from '@evertrust/shared';
import { useMeetings } from '@/hooks/use-meetings';
import { AccountBar } from '@/components/rean/account-bar';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// The R.E.A.N. "Activate" surface (mockup data-page="activate"): a connected
// Google Calendar account bar over three tabs — Meeting Booker (real upcoming
// meetings from the Sales-Agent sync + a read-only/coming-soon slot picker),
// Pre-meeting Research, and After-sales Analysis. Only the upcoming-meetings
// list has a backing API today (useMeetings); everything booking/AI-driven is
// rendered as an explicit coming-soon state rather than faked.
type ActivateTab = 'book' | 'research' | 'after';

export function ActivateView() {
  const t = useTranslations('activate');
  const [tab, setTab] = useState<ActivateTab>('book');
  const meetings = useMeetings();

  // Future ("upcoming") meetings, soonest first. meetingDate may be null.
  const upcoming = useMemo(() => {
    const rows = (meetings.data ?? []).filter((m) => {
      if (!m.meetingDate) return false;
      const ts = Date.parse(m.meetingDate);
      return Number.isFinite(ts) && ts >= Date.now();
    });
    return rows.sort(
      (a, b) => Date.parse(a.meetingDate!) - Date.parse(b.meetingDate!),
    );
  }, [meetings.data]);

  // Account-bar stat line: "N meetings · M free slots". Booked count is the live
  // upcoming list; free slots have no backend yet, so we surface 0 (the
  // coming-soon slot picker explains why) rather than inventing availability.
  const stats = meetings.isLoading
    ? t('account.statsLoading')
    : meetings.isError
      ? t('account.statsError')
      : t('account.stats', { meetings: upcoming.length, slots: 0 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />

      <AccountBar
        service={
          <>
            <Calendar className="size-3.5" />
            {t('account.service')}
          </>
        }
        mailboxes={[]}
        connected={!meetings.isError}
        stats={stats}
      />

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
        <BookTab
          meetings={upcoming}
          isLoading={meetings.isLoading}
          isError={meetings.isError}
        />
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

// ---- Book tab: read-only slot picker (coming soon) + live upcoming list ----
function BookTab({
  meetings,
  isLoading,
  isError,
}: {
  meetings: MeetingDto[];
  isLoading: boolean;
  isError: boolean;
}) {
  const t = useTranslations('activate');

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Pick a slot — no booking API yet, so this is an explicit coming-soon. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">
            {t('book.slots.title')}
          </CardTitle>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" />
            {t('book.slots.pill')}
          </span>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<Lock />}
            title={t('book.slots.comingSoon')}
            description={t('book.slots.comingSoonBody')}
          />
        </CardContent>
      </Card>

      {/* Upcoming meetings — the one live data source on this page. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-muted-foreground" />
            {t('book.upcoming.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('book.upcoming.error')}
            </p>
          ) : meetings.length === 0 ? (
            <EmptyState
              icon={<CalendarClock />}
              title={t('book.upcoming.emptyTitle')}
              description={t('book.upcoming.emptyBody')}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {meetings.map((m) => (
                <MeetingRow key={m.id} meeting={m} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MeetingRow({ meeting }: { meeting: MeetingDto }) {
  const t = useTranslations('activate');
  const format = useFormatter();

  const company =
    meeting.clientCompany ?? t('book.upcoming.noCompany');
  const title = meeting.title ?? t('book.upcoming.untitled');
  const when = meeting.meetingDate
    ? format.dateTime(new Date(meeting.meetingDate), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : t('book.upcoming.noDate');

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{company}</div>
        <div className="truncate text-xs text-muted-foreground">{title}</div>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{when}</span>
      {meeting.score != null ? (
        <Badge variant="outline" className="tabular-nums">
          {t('book.upcoming.scored', { score: meeting.score })}
        </Badge>
      ) : null}
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        {t('book.upcoming.confirmed')}
      </Badge>
    </li>
  );
}
