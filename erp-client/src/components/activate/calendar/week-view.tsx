'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  HOUR_HEIGHT,
  dateKeyToUtcDate,
  overlapsDateKey,
} from '@/components/activate/calendar/time-grid';
import {
  AllDayChip,
  DayColumn,
  TimeScaleColumns,
  TimeScaleHeader,
  WEEKEND_TINT,
  isWeekendIndex,
} from '@/components/activate/calendar/time-gutter';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
} from '@/components/activate/calendar/types';

export function WeekView({
  days,
  weekStartKey,
  events,
  slots,
  selectedEventId,
  onSelectEvent,
  primaryTz,
  secondaryTz,
  freeOnly = false,
  loading = false,
}: {
  days: string[];
  weekStartKey: string;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarGridEvent) => void;
  primaryTz: string;
  secondaryTz: string | null;
  freeOnly?: boolean;
  loading?: boolean;
}) {
  const t = useTranslations('activate');
  const format = useFormatter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // All-day events render in the strip above the timed grid (not as positioned
  // blocks); everything else flows into the time grid. In free-slot mode both
  // are hidden so only the green openings remain.
  const allDayEvents = useMemo(
    () => (freeOnly ? [] : events.filter((event) => event.allDay)),
    [events, freeOnly],
  );
  const timedEvents = useMemo(
    () => (freeOnly ? [] : events.filter((event) => !event.allDay)),
    [events, freeOnly],
  );

  const hasAllDay = allDayEvents.length > 0;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 6 * HOUR_HEIGHT - 10;
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [weekStartKey]);

  return (
    <div className="overflow-x-auto">
      <div className="flex h-[calc(100vh-300px)] min-h-[480px] min-w-[1180px] flex-col">
        <div className="flex border-b pr-2">
          <TimeScaleHeader primaryTz={primaryTz} secondaryTz={secondaryTz} />

          {days.map((dayKey, index) => {
            const dayEvents = timedEvents.filter((event) =>
              overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
            );

            const daySlots = slots.filter((slot) =>
              overlapsDateKey(slot.start, slot.end, dayKey, primaryTz),
            );

            const weekend = isWeekendIndex(index);

            return (
              <div
                key={dayKey}
                className={`flex flex-1 flex-col items-center border-l py-2 text-center ${
                  weekend ? WEEKEND_TINT : ''
                }`}
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
                  {loading
                    ? '…'
                    : freeOnly
                      ? t('calendar.week.slots', { count: daySlots.length })
                      : dayEvents.length > 0
                        ? t('calendar.week.meetings', { count: dayEvents.length })
                        : t('calendar.week.free')}
                </span>
              </div>
            );
          })}
        </div>

        {hasAllDay ? (
          <div className="flex border-b bg-muted/30 pr-2">
            <div
              className={`flex shrink-0 items-center justify-end border-r px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${
                secondaryTz ? 'w-32' : 'w-16'
              }`}
            >
              {t('calendar.allDay')}
            </div>

            {days.map((dayKey, index) => {
              const chips = allDayEvents.filter((event) =>
                overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
              );

              const weekend = isWeekendIndex(index);

              return (
                <div
                  key={dayKey}
                  className={`flex min-h-9 flex-1 flex-col gap-1 border-l px-1 py-1.5 ${
                    weekend ? WEEKEND_TINT : ''
                  }`}
                >
                  {chips.map((event) => (
                    <AllDayChip key={`${event.id}-${event.start}`} event={event} />
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="flex flex-1 items-start overflow-y-auto overflow-x-hidden"
        >
          <TimeScaleColumns
            sampleDayKey={weekStartKey}
            primaryTz={primaryTz}
            secondaryTz={secondaryTz}
          />

          {days.map((dayKey, index) => (
            <DayColumn
              key={dayKey}
              dayKey={dayKey}
              weekend={isWeekendIndex(index)}
              events={timedEvents.filter((event) =>
                overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
              )}
              slots={
                freeOnly
                  ? slots.filter((slot) =>
                      overlapsDateKey(slot.start, slot.end, dayKey, primaryTz),
                    )
                  : []
              }
              selectedEventId={selectedEventId}
              onSelectEvent={onSelectEvent}
              primaryTz={primaryTz}
              secondaryTz={secondaryTz}
              loading={loading}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
