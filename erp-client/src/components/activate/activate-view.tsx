'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
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

const BERLIN_TIME_ZONE = 'Europe/Berlin';
const GMT7_TIME_ZONE = 'Asia/Bangkok';

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WORK_WEEK_DAYS = 5;

type ActivateTab = 'book' | 'research' | 'after';

export function ActivateView() {
  const t = useTranslations('activate');

  const [tab, setTab] = useState<ActivateTab>('book');

  const [calendarWeekStartKey, setCalendarWeekStartKey] = useState(() =>
    startOfWorkWeekKey(new Date(), BERLIN_TIME_ZONE),
  );

  const calendarRange = useMemo(() => {
    const timeMin = zonedTimeToUtcDate(calendarWeekStartKey, 0, 0, BERLIN_TIME_ZONE);

    const timeMax = zonedTimeToUtcDate(
      addDaysToDateKey(calendarWeekStartKey, WORK_WEEK_DAYS),
      0,
      0,
      BERLIN_TIME_ZONE,
    );

    return {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: BERLIN_TIME_ZONE,
    };
  }, [calendarWeekStartKey]);

  const upcoming = useCalendarUpcoming(calendarRange);

  const freeSlots = useCalendarFreeSlots({
    ...calendarRange,
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
        <BookTab
          upcoming={upcoming}
          freeSlots={freeSlots}
          weekStartKey={calendarWeekStartKey}
          onWeekStartKeyChange={setCalendarWeekStartKey}
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

function BookTab({
  upcoming,
  freeSlots,
  weekStartKey,
  onWeekStartKeyChange,
}: {
  upcoming: UpcomingQuery;
  freeSlots: FreeSlotsQuery;
  weekStartKey: string;
  onWeekStartKeyChange: Dispatch<SetStateAction<string>>;
}) {
  const t = useTranslations('activate');
  const format = useFormatter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const configured = Boolean(upcoming.data?.configured || freeSlots.data?.configured);

  const reason = upcoming.data?.reason ?? freeSlots.data?.reason ?? null;

  const rawEvents = upcoming.data?.events ?? [];
  const rawSlots = freeSlots.data?.slots ?? [];

  const days = useMemo(
    () => Array.from({ length: WORK_WEEK_DAYS }, (_, i) => addDaysToDateKey(weekStartKey, i)),
    [weekStartKey],
  );

  const weekEndKey = useMemo(() => addDaysToDateKey(weekStartKey, WORK_WEEK_DAYS), [weekStartKey]);

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

        return overlapsDateKeyRange(
          event.startDate,
          event.endDate,
          weekStartKey,
          weekEndKey,
          BERLIN_TIME_ZONE,
        );
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [rawEvents, weekStartKey, weekEndKey]);

  const gridSlots = useMemo<CalendarGridSlot[]>(() => {
    return rawSlots
      .map((slot) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
      }))
      .filter((slot) => {
        if (!isValidDate(slot.start) || !isValidDate(slot.end)) {
          return false;
        }

        return overlapsDateKeyRange(
          slot.start,
          slot.end,
          weekStartKey,
          weekEndKey,
          BERLIN_TIME_ZONE,
        );
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [rawSlots, weekStartKey, weekEndKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 7 * HOUR_HEIGHT - 10;
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [weekStartKey]);

  const weekRange = `${format.dateTime(dateKeyToUtcDate(weekStartKey), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  })} – ${format.dateTime(dateKeyToUtcDate(addDaysToDateKey(weekStartKey, WORK_WEEK_DAYS - 1)), {
    timeZone: 'UTC',
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
            Calendar · Week {getIsoWeekNumber(weekStartKey)}
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
              onClick={() => onWeekStartKeyChange((key) => addDaysToDateKey(key, -7))}
            >
              <ChevronLeft className="size-4" />
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => onWeekStartKeyChange(startOfWorkWeekKey(new Date(), BERLIN_TIME_ZONE))}
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
              onClick={() => onWeekStartKeyChange((key) => addDaysToDateKey(key, 7))}
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
          <div className="flex h-[calc(100vh-300px)] min-h-[420px] min-w-[900px] flex-col">
            <div className="flex border-b pr-2">
              <TimeScaleHeader />

              {days.map((dayKey) => {
                const dayEvents = gridEvents.filter((event) =>
                  overlapsDateKey(event.startDate, event.endDate, dayKey, BERLIN_TIME_ZONE),
                );

                const daySlots = gridSlots.filter((slot) =>
                  overlapsDateKey(slot.start, slot.end, dayKey, BERLIN_TIME_ZONE),
                );

                return (
                  <div
                    key={dayKey}
                    className="flex flex-1 flex-col items-center border-l py-2 text-center"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {format.dateTime(dateKeyToUtcDate(dayKey), {
                        timeZone: 'UTC',
                        weekday: 'short',
                      })}
                    </span>

                    <span className="text-[10px] font-medium text-muted-foreground">
                      {format.dateTime(dateKeyToUtcDate(dayKey), {
                        timeZone: 'UTC',
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
              <TimeScaleColumns sampleDayKey={weekStartKey} />

              {days.map((dayKey) => (
                <DayColumn
                  key={dayKey}
                  dayKey={dayKey}
                  events={gridEvents.filter((event) =>
                    overlapsDateKey(event.startDate, event.endDate, dayKey, BERLIN_TIME_ZONE),
                  )}
                  slots={gridSlots.filter((slot) =>
                    overlapsDateKey(slot.start, slot.end, dayKey, BERLIN_TIME_ZONE),
                  )}
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

            <span>Positioned by Germany time. Left gutter also shows GMT+7.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimeScaleHeader() {
  return (
    <div className="grid w-32 shrink-0 grid-cols-2 border-r">
      <div className="flex items-end justify-end border-r px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        GMT+7
      </div>

      <div className="flex items-end justify-end px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        CET/CEST
      </div>
    </div>
  );
}

function TimeScaleColumns({ sampleDayKey }: { sampleDayKey: string }) {
  const labels = useMemo(() => {
    return HOURS.map((hour) => {
      const instant = zonedTimeToUtcDate(sampleDayKey, hour, 0, BERLIN_TIME_ZONE);

      return {
        hour,
        gmt7: formatClockInTimeZone(instant, GMT7_TIME_ZONE),
        berlin: formatClockInTimeZone(instant, BERLIN_TIME_ZONE),
      };
    });
  }, [sampleDayKey]);

  return (
    <div className="grid w-32 shrink-0 grid-cols-2" style={{ height: HOURS.length * HOUR_HEIGHT }}>
      <div className="relative border-r">
        {labels.map((label) => (
          <div
            key={`gmt7-${label.hour}`}
            className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground"
            style={{ top: label.hour * HOUR_HEIGHT }}
          >
            {label.gmt7}
          </div>
        ))}
      </div>

      <div className="relative">
        {labels.map((label) => (
          <div
            key={`berlin-${label.hour}`}
            className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground"
            style={{ top: label.hour * HOUR_HEIGHT }}
          >
            {label.berlin}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  dayKey,
  events,
  slots,
}: {
  dayKey: string;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
}) {
  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden border-l border-b"
      style={{ height: HOURS.length * HOUR_HEIGHT }}
      aria-label={dayKey}
    >
      {HOURS.map((hour) => (
        <div key={hour} className="h-14 shrink-0 border-t" style={{ height: HOUR_HEIGHT }} />
      ))}

      {slots.map((slot) => (
        <CalendarSlotBlock
          key={`${slot.start.toISOString()}-${slot.end.toISOString()}`}
          dayKey={dayKey}
          start={slot.start}
          end={slot.end}
        />
      ))}

      {events.map((event) => (
        <CalendarEventBlock key={event.id} dayKey={dayKey} event={event} />
      ))}
    </div>
  );
}

function CalendarSlotBlock({ dayKey, start, end }: { dayKey: string; start: Date; end: Date }) {
  const t = useTranslations('activate');

  const visual = getVisualRangeForDateKey(start, end, dayKey, BERLIN_TIME_ZONE);

  const top = minuteToTop(visual.startMinute);
  const height = minuteRangeToHeight(visual.startMinute, visual.endMinute);

  const berlinFrom = formatClockInTimeZone(start, BERLIN_TIME_ZONE);
  const berlinTo = formatClockInTimeZone(end, BERLIN_TIME_ZONE);
  const gmt7From = formatClockInTimeZone(start, GMT7_TIME_ZONE);
  const gmt7To = formatClockInTimeZone(end, GMT7_TIME_ZONE);

  return (
    <button
      type="button"
      disabled
      className="absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-left text-[10px] text-emerald-700 opacity-90 transition-colors disabled:cursor-not-allowed dark:text-emerald-300"
      style={{
        top,
        height,
      }}
      title={`DE ${berlinFrom}–${berlinTo} · GMT+7 ${gmt7From}–${gmt7To}`}
      aria-label={t('book.slots.rangeAria', {
        start: berlinFrom,
        end: berlinTo,
      })}
    >
      <span className="block font-semibold tabular-nums">
        DE {berlinFrom}–{berlinTo}
      </span>

      <span className="block truncate tabular-nums">
        GMT+7 {gmt7From}–{gmt7To}
      </span>

      <span className="block truncate">{t('book.slots.book')}</span>
    </button>
  );
}

function CalendarEventBlock({ dayKey, event }: { dayKey: string; event: CalendarGridEvent }) {
  const t = useTranslations('activate');

  const visual = getVisualRangeForDateKey(event.startDate, event.endDate, dayKey, BERLIN_TIME_ZONE);

  const top = minuteToTop(visual.startMinute);
  const height = minuteRangeToHeight(visual.startMinute, visual.endMinute);

  const berlinFrom = formatClockInTimeZone(event.startDate, BERLIN_TIME_ZONE);
  const berlinTo = formatClockInTimeZone(event.endDate, BERLIN_TIME_ZONE);
  const gmt7From = formatClockInTimeZone(event.startDate, GMT7_TIME_ZONE);
  const gmt7To = formatClockInTimeZone(event.endDate, GMT7_TIME_ZONE);

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
      title={`${title} · DE ${berlinFrom}–${berlinTo} · GMT+7 ${gmt7From}–${gmt7To}`}
      aria-label={`${title} Germany ${berlinFrom} to ${berlinTo}`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
        <Clock className="size-3" />

        <span className="truncate tabular-nums">
          DE {berlinFrom}–{berlinTo}
        </span>
      </div>

      <div className="truncate text-[10px] font-medium text-muted-foreground">
        GMT+7 {gmt7From}–{gmt7To}
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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseDateKey(dateKey: string): {
  year: number;
  month: number;
  day: number;
} {
  const parts = dateKey.split('-');

  const yearText = parts[0];
  const monthText = parts[1];
  const dayText = parts[2];

  if (!yearText || !monthText || !dayText) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  return {
    year,
    month,
    day,
  };
}

function dateKeyToUtcDate(dateKey: string): Date {
  const { year, month, day } = parseDateKey(dateKey);

  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);

  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));

  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getZonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

  const rawHour = Number(get('hour'));

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get('minute')),
  };
}

function zonedTimeToUtcDate(dateKey: string, hour: number, minute: number, timeZone: string): Date {
  const { year, month, day } = parseDateKey(dateKey);

  const wantedLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let utcMs = wantedLocalMs;

  for (let i = 0; i < 3; i += 1) {
    const actualParts = getZonedParts(new Date(utcMs), timeZone);

    const actualLocalMs = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
      0,
      0,
    );

    utcMs += wantedLocalMs - actualLocalMs;
  }

  return new Date(utcMs);
}

function startOfWorkWeekKey(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  const currentKey = toDateKey(parts.year, parts.month, parts.day);
  const currentDate = dateKeyToUtcDate(currentKey);
  const day = currentDate.getUTCDay();

  const diffToMonday = day === 0 ? -6 : 1 - day;

  return addDaysToDateKey(currentKey, diffToMonday);
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function overlapsDateKey(start: Date, end: Date, dateKey: string, timeZone: string): boolean {
  if (!isValidDate(start) || !isValidDate(end) || end <= start) {
    return false;
  }

  const dayStart = zonedTimeToUtcDate(dateKey, 0, 0, timeZone);
  const dayEnd = zonedTimeToUtcDate(addDaysToDateKey(dateKey, 1), 0, 0, timeZone);

  return end > dayStart && start < dayEnd;
}

function overlapsDateKeyRange(
  start: Date,
  end: Date,
  startKey: string,
  endKeyExclusive: string,
  timeZone: string,
): boolean {
  if (!isValidDate(start) || !isValidDate(end) || end <= start) {
    return false;
  }

  const rangeStart = zonedTimeToUtcDate(startKey, 0, 0, timeZone);
  const rangeEnd = zonedTimeToUtcDate(endKeyExclusive, 0, 0, timeZone);

  return end > rangeStart && start < rangeEnd;
}

function getVisualRangeForDateKey(
  start: Date,
  end: Date,
  dateKey: string,
  timeZone: string,
): {
  startMinute: number;
  endMinute: number;
} {
  const dayStart = zonedTimeToUtcDate(dateKey, 0, 0, timeZone);
  const dayEnd = zonedTimeToUtcDate(addDaysToDateKey(dateKey, 1), 0, 0, timeZone);

  const visualStart = start < dayStart ? dayStart : start;
  const visualEnd = end > dayEnd ? dayEnd : end;

  if (visualEnd <= visualStart) {
    return {
      startMinute: 0,
      endMinute: 30,
    };
  }

  const startMinute =
    visualStart <= dayStart ? 0 : zonedMinutesSinceMidnight(visualStart, timeZone);

  const rawEndMinute =
    visualEnd >= dayEnd ? 24 * 60 : zonedMinutesSinceMidnight(visualEnd, timeZone);

  return {
    startMinute,
    endMinute: Math.min(24 * 60, Math.max(startMinute + 30, rawEndMinute)),
  };
}

function zonedMinutesSinceMidnight(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);

  return parts.hour * 60 + parts.minute;
}

function minuteToTop(minute: number): number {
  const rawTop = (minute / 60) * HOUR_HEIGHT;
  const maxTop = HOURS.length * HOUR_HEIGHT - 28;

  return Math.max(0, Math.min(rawTop, maxTop));
}

function minuteRangeToHeight(startMinute: number, endMinute: number): number {
  const minutes = Math.max(30, endMinute - startMinute);

  return Math.max(28, (minutes / 60) * HOUR_HEIGHT);
}

function getIsoWeekNumber(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);

  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));

  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatClockInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
