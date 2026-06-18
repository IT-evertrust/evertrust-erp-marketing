'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarX,
  Mic,
  Search,
  Video,
} from 'lucide-react';
import type {
  CalendarEventDto,
  CalendarFreeSlotsDto,
  CalendarUpcomingDto,
} from '@evertrust/shared';
import {
  useCalendarFreeSlots,
  useCalendarUpcoming,
} from '@/hooks/use-meetings';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// The R.E.A.N. "Activate" surface (mockup data-page="activate"): a connected
// Google Calendar account bar over three tabs — Meeting Booker (real upcoming
// events + proposed free slots read live from the org's connected calendar via
// /meetings/calendar/*), Pre-meeting Research, and After-sales Analysis. The
// research/after tabs have no backend yet and stay as explicit coming-soon
// states.
type ActivateTab = 'book' | 'research' | 'after';

export function ActivateView() {
  const t = useTranslations('activate');
  const [tab, setTab] = useState<ActivateTab>('book');
  const upcoming = useCalendarUpcoming();
  const freeSlots = useCalendarFreeSlots();

  // The calendar is "connected" when the org has a default Google account with
  // Calendar access (configured===true). The upcoming query is the source of
  // truth for the account bar; the free-slots query mirrors the same flag.
  const configured = upcoming.data?.configured ?? false;
  const email = upcoming.data?.account?.email ?? null;

  // Account-bar pill copy: connected (with email) / not connected.
  const service = (
    <>
      <Calendar className="size-3.5" />
      {configured && email
        ? t('account.connected', { email })
        : t('account.service')}
    </>
  );

  // Stat line: live booked count · live free-slot count, with loading/error
  // states while either query resolves.
  const stats = upcoming.isLoading
    ? t('account.statsLoading')
    : upcoming.isError
      ? t('account.statsError')
      : t('account.stats', {
          meetings: upcoming.data?.events.length ?? 0,
          slots: freeSlots.data?.slots.length ?? 0,
        });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />

      <AccountBar
        service={service}
        mailboxes={[]}
        connected={configured}
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
        <BookTab upcoming={upcoming} freeSlots={freeSlots} />
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

type UpcomingQuery = {
  data?: CalendarUpcomingDto;
  isLoading: boolean;
  isError: boolean;
};
type FreeSlotsQuery = {
  data?: CalendarFreeSlotsDto;
  isLoading: boolean;
  isError: boolean;
};

// Shared "connect a Google Calendar" empty state, linking to Configuration. When the
// server returns a precise `reason` (no Calendar scope, token error, etc.) show it
// instead of the generic copy, so the user knows exactly what to fix.
function ConnectHint({ reason }: { reason?: string | null }) {
  const t = useTranslations('activate');
  return (
    <EmptyState
      icon={<CalendarX />}
      title={t('book.notConnectedTitle')}
      description={reason ?? t('book.notConnectedBody')}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/configuration">{t('book.connectCta')}</Link>
        </Button>
      }
    />
  );
}

// ---- Book tab: live free-slot picker (display-only) + live upcoming events ----
function BookTab({
  upcoming,
  freeSlots,
}: {
  upcoming: UpcomingQuery;
  freeSlots: FreeSlotsQuery;
}) {
  const t = useTranslations('activate');

  const slotsConfigured = freeSlots.data?.configured ?? false;
  const slots = freeSlots.data?.slots ?? [];
  const upcomingConfigured = upcoming.data?.configured ?? false;
  const events = upcoming.data?.events ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Pick a slot — real proposed openings; booking is display-only for now. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">
            {t('book.slots.title')}
          </CardTitle>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Calendar className="size-3.5" />
            {t('book.slots.pill')}
          </span>
        </CardHeader>
        <CardContent>
          {freeSlots.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : freeSlots.isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('book.upcoming.error')}
            </p>
          ) : !slotsConfigured ? (
            <ConnectHint reason={freeSlots.data?.reason} />
          ) : slots.length === 0 ? (
            <EmptyState
              icon={<CalendarX />}
              title={t('book.slots.comingSoon')}
              description={t('book.slots.comingSoonBody')}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col gap-2">
                {slots.map((s) => (
                  <SlotRow key={s.start} start={s.start} end={s.end} />
                ))}
              </ul>
              <p className="pt-1 text-center text-xs text-muted-foreground">
                {t('book.slots.bookingHint')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming meetings — live events from the connected Google Calendar. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-muted-foreground" />
            {t('book.upcoming.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : upcoming.isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('book.upcoming.error')}
            </p>
          ) : !upcomingConfigured ? (
            <ConnectHint reason={upcoming.data?.reason} />
          ) : events.length === 0 ? (
            <EmptyState
              icon={<CalendarClock />}
              title={t('book.upcoming.emptyTitle')}
              description={t('book.upcoming.emptyBody')}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// One proposed free slot: weekday + HH:MM–HH:MM range, with a disabled "Book".
function SlotRow({ start, end }: { start: string; end: string }) {
  const t = useTranslations('activate');
  const format = useFormatter();

  const startDate = new Date(start);
  const endDate = new Date(end);
  const day = format.dateTime(startDate, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const from = format.dateTime(startDate, { hour: '2-digit', minute: '2-digit' });
  const to = format.dateTime(endDate, { hour: '2-digit', minute: '2-digit' });

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{day}</div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {from}–{to}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled
        aria-label={t('book.slots.rangeAria', { start: from, end: to })}
      >
        {t('book.slots.book')}
      </Button>
    </li>
  );
}

// One upcoming calendar event: title, formatted start, external attendees, and
// a Join link when the event carries a meeting URL.
function EventRow({ event }: { event: CalendarEventDto }) {
  const t = useTranslations('activate');
  const format = useFormatter();

  const title = event.title || t('book.upcoming.untitled');
  const when = format.dateTime(new Date(event.start), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const attendees =
    event.attendees.length > 0
      ? event.attendees.join(', ')
      : t('book.upcoming.noAttendees');

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{attendees}</div>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{when}</span>
      {event.meetingUrl ? (
        <Button asChild size="sm" variant="outline">
          <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer">
            <Video className="size-3.5" />
            {t('book.upcoming.join')}
          </a>
        </Button>
      ) : null}
    </li>
  );
}
