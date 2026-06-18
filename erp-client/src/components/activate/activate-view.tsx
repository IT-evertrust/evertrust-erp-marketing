'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mic,
  Search,
  Users,
  Video,
} from 'lucide-react';
import type {
  CalendarEventDto,
  CalendarFreeSlotsDto,
  CalendarUpcomingDto,
} from '@evertrust/shared';
import { useCalendarFreeSlots, useCalendarUpcoming } from '@/hooks/use-meetings';
import { AccountBar } from '@/components/rean/account-bar';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type ActivateTab = 'book' | 'research' | 'after';

export function ActivateView() {
  const t = useTranslations('activate');
  const [tab, setTab] = useState<ActivateTab>('book');

  const upcoming = useCalendarUpcoming();
  const freeSlots = useCalendarFreeSlots();

  const configured = upcoming.data?.configured ?? false;
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

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WORK_WEEK_DAYS = 5;

type CalendarGridEvent = CalendarEventDto & {
  startDate: Date;
  endDate: Date;
};

type CalendarGridSlot = {
  start: Date;
  end: Date;
};

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

function BookTab({ upcoming, freeSlots }: { upcoming: UpcomingQuery; freeSlots: FreeSlotsQuery }) {
  const t = useTranslations('activate');
  const format = useFormatter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [weekStart, setWeekStart] = useState(() => startOfWorkWeek(new Date()));

  const configured = upcoming.data?.configured ?? freeSlots.data?.configured ?? false;

  const reason = upcoming.data?.reason ?? freeSlots.data?.reason ?? null;

  const rawEvents = upcoming.data?.events ?? [];
  const rawSlots = freeSlots.data?.slots ?? [];

  const days = useMemo(
    () => Array.from({ length: WORK_WEEK_DAYS }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const weekEnd = useMemo(() => addDays(weekStart, WORK_WEEK_DAYS), [weekStart]);

  const gridEvents = useMemo<CalendarGridEvent[]>(() => {
    return rawEvents
      .map((event) => {
        const startDate = new Date(event.start);
        const endDate = new Date(event.end);

        return {
          ...event,
          startDate,
          endDate,
        };
      })
      .filter((event) => {
        if (!isValidDate(event.startDate) || !isValidDate(event.endDate)) {
          return false;
        }

        return event.endDate > weekStart && event.startDate < weekEnd;
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [rawEvents, weekStart, weekEnd]);

  const gridSlots = useMemo<CalendarGridSlot[]>(() => {
    return rawSlots
      .map((slot) => {
        const start = new Date(slot.start);
        const end = new Date(slot.end);

        return {
          start,
          end,
        };
      })
      .filter((slot) => {
        if (!isValidDate(slot.start) || !isValidDate(slot.end)) {
          return false;
        }

        return slot.end > weekStart && slot.start < weekEnd;
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [rawSlots, weekStart, weekEnd]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 7 * HOUR_HEIGHT - 10;
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [weekStart]);

  const weekRange = `${format.dateTime(weekStart, {
    day: 'numeric',
    month: 'short',
  })} – ${format.dateTime(addDays(weekStart, WORK_WEEK_DAYS - 1), {
    day: 'numeric',
    month: 'short',
  })}`;

  if (upcoming.isLoading || freeSlots.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[420px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (upcoming.isError || freeSlots.isError) {
    return (
      <Card>
        <CardContent className="py-10">
          <p className="text-center text-sm text-muted-foreground">{t('book.upcoming.error')}</p>
        </CardContent>
      </Card>
    );
  }

  if (!configured) {
    return <ConnectHint reason={reason} />;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm font-semibold">
            Calendar · Week {getIsoWeekNumber(weekStart)}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {gridEvents.length} meetings · {gridSlots.length} proposed free slots
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Previous week"
              onClick={() => setWeekStart((date) => addWeeks(date, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setWeekStart(startOfWorkWeek(new Date()))}
            >
              Today
            </Button>

            <span className="min-w-28 text-center text-xs font-semibold text-muted-foreground">
              {weekRange}
            </span>

            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Next week"
              onClick={() => setWeekStart((date) => addWeeks(date, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Google Calendar connected
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="flex h-[calc(100vh-300px)] min-h-[420px] min-w-[760px] flex-col">
            <div className="flex border-b pr-2">
              <div className="flex w-16 shrink-0 items-end justify-end px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Local
              </div>

              {days.map((day) => {
                const dayEvents = gridEvents.filter((event) =>
                  overlapsDay(event.startDate, event.endDate, day),
                );

                const daySlots = gridSlots.filter((slot) => overlapsDay(slot.start, slot.end, day));

                return (
                  <div
                    key={day.toISOString()}
                    className="flex flex-1 flex-col items-center border-l py-2 text-center"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {format.dateTime(day, { weekday: 'short' })}
                    </span>

                    <span className="text-[10px] font-medium text-muted-foreground">
                      {format.dateTime(day, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>

                    <span className="mt-1 text-[10px] text-muted-foreground">
                      {dayEvents.length > 0
                        ? `${dayEvents.length} ${dayEvents.length === 1 ? 'meeting' : 'meetings'}`
                        : daySlots.length > 0
                          ? `${daySlots.length} ${daySlots.length === 1 ? 'slot' : 'slots'}`
                          : 'free'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              ref={scrollRef}
              className="flex flex-1 items-start overflow-y-auto overflow-x-hidden"
            >
              <div
                className="relative w-16 shrink-0"
                style={{ height: HOURS.length * HOUR_HEIGHT }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground"
                    style={{ top: hour * HOUR_HEIGHT }}
                  >
                    {formatHour(hour)}
                  </div>
                ))}
              </div>

              {days.map((day) => (
                <DayColumn
                  key={day.toISOString()}
                  day={day}
                  events={gridEvents.filter((event) =>
                    overlapsDay(event.startDate, event.endDate, day),
                  )}
                  slots={gridSlots.filter((slot) => overlapsDay(slot.start, slot.end, day))}
                />
              ))}
            </div>
          </div>
        </div>

        {gridEvents.length === 0 && gridSlots.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-t px-4 py-3 text-center text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" />
            {t('book.upcoming.emptyBody')}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              Solid blocks are booked Google Calendar events. Dashed blocks are proposed free slots.
            </span>
            <span>{t('book.slots.bookingHint')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DayColumn({
  day,
  events,
  slots,
}: {
  day: Date;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
}) {
  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden border-l border-b"
      style={{ height: HOURS.length * HOUR_HEIGHT }}
      aria-label={day.toDateString()}
    >
      {HOURS.map((hour) => (
        <div key={hour} className="h-14 shrink-0 border-t" style={{ height: HOUR_HEIGHT }} />
      ))}

      {slots.map((slot) => (
        <CalendarSlotBlock
          key={`${slot.start.toISOString()}-${slot.end.toISOString()}`}
          day={day}
          start={slot.start}
          end={slot.end}
        />
      ))}

      {events.map((event) => (
        <CalendarEventBlock key={event.id} day={day} event={event} />
      ))}
    </div>
  );
}

function CalendarSlotBlock({ day, start, end }: { day: Date; start: Date; end: Date }) {
  const t = useTranslations('activate');
  const format = useFormatter();

  const visual = getVisualRangeForDay(start, end, day);
  const top = eventTop(visual.start);
  const height = eventHeight(visual.start, visual.end);

  const from = format.dateTime(visual.start, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const to = format.dateTime(visual.end, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <button
      type="button"
      disabled
      className="absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-left text-[10px] text-emerald-700 opacity-90 transition-colors disabled:cursor-not-allowed dark:text-emerald-300"
      style={{
        top,
        height,
      }}
      title={`${from}–${to}`}
      aria-label={t('book.slots.rangeAria', { start: from, end: to })}
    >
      <span className="block font-semibold tabular-nums">
        {from}–{to}
      </span>
      <span className="block truncate">{t('book.slots.book')}</span>
    </button>
  );
}

function CalendarEventBlock({ day, event }: { day: Date; event: CalendarGridEvent }) {
  const t = useTranslations('activate');
  const format = useFormatter();

  const visual = getVisualRangeForDay(event.startDate, event.endDate, day);
  const top = eventTop(visual.start);
  const height = eventHeight(visual.start, visual.end);

  const from = format.dateTime(visual.start, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const to = format.dateTime(visual.end, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const title = event.title || t('book.upcoming.untitled');
  const attendees = event.attendees ?? [];

  const attendeeLabel =
    attendees.length > 0 ? attendees.join(', ') : t('book.upcoming.noAttendees');

  return (
    <div
      className="absolute left-1.5 right-1.5 z-20 overflow-hidden rounded-md border border-border border-l-2 border-l-foreground bg-card px-2 py-1 shadow-sm"
      style={{
        top,
        height,
      }}
      title={`${title} · ${from}–${to}`}
      aria-label={`${title} ${from} to ${to}`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
        <Clock className="size-3" />
        <span className="truncate tabular-nums">
          {from}–{to}
        </span>
      </div>

      <div className="truncate text-xs font-semibold">{title}</div>

      <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
        <Users className="size-3" />
        <span className="truncate">{attendeeLabel}</span>
      </div>

      {event.meetingUrl ? (
        <a
          href={event.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold underline-offset-2 hover:underline"
        >
          <Video className="size-3" />
          {t('book.upcoming.join')}
        </a>
      ) : null}
    </div>
  );
}

function startOfWorkWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);

  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);

  d.setHours(0, 0, 0, 0);

  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);

  d.setDate(d.getDate() + days);

  return d;
}

function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function overlapsDay(start: Date, end: Date, day: Date): boolean {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  return end > dayStart && start < dayEnd;
}

function getVisualRangeForDay(
  start: Date,
  end: Date,
  day: Date,
): {
  start: Date;
  end: Date;
} {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  return {
    start: start < dayStart ? dayStart : start,
    end: end > dayEnd ? dayEnd : end,
  };
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function eventTop(date: Date): number {
  const rawTop = (minutesSinceMidnight(date) / 60) * HOUR_HEIGHT;
  const maxTop = HOURS.length * HOUR_HEIGHT - 28;

  return Math.max(0, Math.min(rawTop, maxTop));
}

function eventHeight(start: Date, end: Date): number {
  const minutes = Math.max(30, (end.getTime() - start.getTime()) / 1000 / 60);

  return Math.max(28, (minutes / 60) * HOUR_HEIGHT);
}

function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

  const dayNumber = d.getUTCDay() || 7;

  d.setUTCDate(d.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';

  return `${hour - 12} PM`;
}
