'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { CalendarClock, CalendarX, ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  HOUR_HEIGHT,
  HOURS,
  addDaysToDateKey,
  dateKeyToUtcDate,
  formatClockInTimeZone,
  getIsoWeekNumber,
  overlapsDateKey,
  overlapsDateKeyRange,
  isValidDate,
  startOfWorkWeekKey,
  zoneShortLabel,
  zonedTimeToUtcDate,
} from '@/components/activate/calendar/time-grid';
import { CalendarEventBlock, layoutDayEvents } from '@/components/activate/calendar/event-block';
import { CalendarSlotBlock } from '@/components/activate/calendar/slot-block';
import { CalendarEventDetailsDialog } from '@/components/activate/calendar/event-details-dialog';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
  FreeSlotsQuery,
  UpcomingQuery,
} from '@/components/activate/calendar/types';

const WORK_WEEK_DAYS = 5;

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

export function Calendar({
  upcoming,
  freeSlots,
  weekStartKey,
  onWeekStartKeyChange,
  primaryTz,
  secondaryTz,
}: {
  upcoming: UpcomingQuery;
  freeSlots: FreeSlotsQuery;
  weekStartKey: string;
  onWeekStartKeyChange: Dispatch<SetStateAction<string>>;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const t = useTranslations('activate');
  const format = useFormatter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<CalendarGridEvent | null>(null);

  const configured = Boolean(upcoming.data?.configured || freeSlots.data?.configured);

  const reason = upcoming.data?.reason ?? freeSlots.data?.reason ?? null;

  const days = useMemo(
    () => Array.from({ length: WORK_WEEK_DAYS }, (_, i) => addDaysToDateKey(weekStartKey, i)),
    [weekStartKey],
  );

  const weekEndKey = useMemo(() => addDaysToDateKey(weekStartKey, WORK_WEEK_DAYS), [weekStartKey]);

  const gridEvents = useMemo<CalendarGridEvent[]>(() => {
    return (upcoming.data?.events ?? [])
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
          primaryTz,
        );
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [upcoming.data?.events, weekStartKey, weekEndKey, primaryTz]);

  const gridSlots = useMemo<CalendarGridSlot[]>(() => {
    return (freeSlots.data?.slots ?? [])
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
          primaryTz,
        );
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [freeSlots.data?.slots, weekStartKey, weekEndKey, primaryTz]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 6 * HOUR_HEIGHT - 10;
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
    <>
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
                onClick={() =>
                  onWeekStartKeyChange(startOfWorkWeekKey(new Date(), primaryTz))
                }
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
            <div className="flex h-[calc(100vh-300px)] min-h-[480px] min-w-[980px] flex-col">
              <div className="flex border-b pr-2">
                <TimeScaleHeader primaryTz={primaryTz} secondaryTz={secondaryTz} />

                {days.map((dayKey) => {
                  const dayEvents = gridEvents.filter((event) =>
                    overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
                  );

                  const daySlots = gridSlots.filter((slot) =>
                    overlapsDateKey(slot.start, slot.end, dayKey, primaryTz),
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
                <TimeScaleColumns
                  sampleDayKey={weekStartKey}
                  primaryTz={primaryTz}
                  secondaryTz={secondaryTz}
                />

                {days.map((dayKey) => (
                  <DayColumn
                    key={dayKey}
                    dayKey={dayKey}
                    events={gridEvents.filter((event) =>
                      overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
                    )}
                    slots={gridSlots.filter((slot) =>
                      overlapsDateKey(slot.start, slot.end, dayKey, primaryTz),
                    )}
                    selectedEventId={selectedEvent?.id ?? null}
                    onSelectEvent={setSelectedEvent}
                    primaryTz={primaryTz}
                    secondaryTz={secondaryTz}
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
                Click a solid meeting card to open details. Dashed blocks are proposed free slots.
              </span>

              <span>
                {secondaryTz
                  ? `Positioned by ${zoneShortLabel(primaryTz)}. Left gutter also shows ${zoneShortLabel(secondaryTz)}.`
                  : `Positioned by ${zoneShortLabel(primaryTz)}.`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <CalendarEventDetailsDialog
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        primaryTz={primaryTz}
        secondaryTz={secondaryTz}
      />
    </>
  );
}

// Gutter header. Dual-scale (org has a secondary zone): secondary on the left, primary
// on the right. Single-scale (secondary null): one primary column. Labels are derived
// from each IANA zone (e.g. "GMT+2"), never hardcoded.
function TimeScaleHeader({
  primaryTz,
  secondaryTz,
}: {
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const cell =
    'flex items-end justify-end px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';

  if (!secondaryTz) {
    return (
      <div className="w-16 shrink-0 border-r">
        <div className={`h-full ${cell}`}>{zoneShortLabel(primaryTz)}</div>
      </div>
    );
  }

  return (
    <div className="grid w-32 shrink-0 grid-cols-2 border-r">
      <div className={`border-r ${cell}`}>{zoneShortLabel(secondaryTz)}</div>
      <div className={cell}>{zoneShortLabel(primaryTz)}</div>
    </div>
  );
}

function TimeScaleColumns({
  sampleDayKey,
  primaryTz,
  secondaryTz,
}: {
  sampleDayKey: string;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const labels = useMemo(() => {
    return HOURS.map((hour) => {
      const instant = zonedTimeToUtcDate(sampleDayKey, hour, 0, primaryTz);

      return {
        hour,
        secondary: secondaryTz ? formatClockInTimeZone(instant, secondaryTz) : null,
        primary: formatClockInTimeZone(instant, primaryTz),
      };
    });
  }, [sampleDayKey, primaryTz, secondaryTz]);

  const labelCell =
    'absolute right-2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground';

  if (!secondaryTz) {
    return (
      <div className="w-16 shrink-0" style={{ height: HOURS.length * HOUR_HEIGHT }}>
        <div className="relative border-r">
          {labels.map((label) => (
            <div key={`primary-${label.hour}`} className={labelCell} style={{ top: label.hour * HOUR_HEIGHT }}>
              {label.primary}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid w-32 shrink-0 grid-cols-2" style={{ height: HOURS.length * HOUR_HEIGHT }}>
      <div className="relative border-r">
        {labels.map((label) => (
          <div key={`secondary-${label.hour}`} className={labelCell} style={{ top: label.hour * HOUR_HEIGHT }}>
            {label.secondary}
          </div>
        ))}
      </div>

      <div className="relative">
        {labels.map((label) => (
          <div key={`primary-${label.hour}`} className={labelCell} style={{ top: label.hour * HOUR_HEIGHT }}>
            {label.primary}
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
  selectedEventId,
  onSelectEvent,
  primaryTz,
  secondaryTz,
}: {
  dayKey: string;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarGridEvent) => void;
  primaryTz: string;
  secondaryTz: string | null;
}) {
  const laidOutEvents = useMemo(
    () => layoutDayEvents(events, dayKey, primaryTz),
    [events, dayKey, primaryTz],
  );

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
          primaryTz={primaryTz}
          secondaryTz={secondaryTz}
        />
      ))}

      {laidOutEvents.map((event) => (
        <CalendarEventBlock
          key={`${event.id}-${event.start}`}
          dayKey={dayKey}
          event={event}
          selected={selectedEventId === event.id}
          onSelect={() => onSelectEvent(event)}
          primaryTz={primaryTz}
          secondaryTz={secondaryTz}
        />
      ))}
    </div>
  );
}
