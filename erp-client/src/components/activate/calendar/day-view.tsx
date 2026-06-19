'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFormatter } from 'next-intl';
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
  isWeekendDateKey,
} from '@/components/activate/calendar/time-gutter';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
} from '@/components/activate/calendar/types';

// Single-day timeline. Shares the gutter (TimeScaleHeader/Columns) and the timed
// grid (DayColumn) with the Week view — the same zone-aware positioning math runs
// here, just in one full-width column instead of seven narrow ones. Richer event
// cards (title, time, guests, Meet badge) come for free from CalendarEventBlock,
// which renders its roomy variant once a block is wide/tall enough.
export function DayView({
  dayKey,
  events,
  slots,
  selectedEventId,
  onSelectEvent,
  primaryTz,
  secondaryTz,
  freeOnly = false,
}: {
  dayKey: string;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarGridEvent) => void;
  primaryTz: string;
  secondaryTz: string | null;
  freeOnly?: boolean;
}) {
  const format = useFormatter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const weekend = isWeekendDateKey(dayKey);

  // In free-slot mode both the all-day strip and the timed event blocks are
  // hidden so only the green openings remain.
  const allDayEvents = useMemo(
    () =>
      freeOnly
        ? []
        : events.filter(
            (event) =>
              event.allDay &&
              overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
          ),
    [events, freeOnly, dayKey, primaryTz],
  );

  const timedEvents = useMemo(
    () =>
      freeOnly
        ? []
        : events.filter(
            (event) =>
              !event.allDay &&
              overlapsDateKey(event.startDate, event.endDate, dayKey, primaryTz),
          ),
    [events, freeOnly, dayKey, primaryTz],
  );

  const daySlots = useMemo(
    () =>
      slots.filter((slot) => overlapsDateKey(slot.start, slot.end, dayKey, primaryTz)),
    [slots, dayKey, primaryTz],
  );

  const hasAllDay = allDayEvents.length > 0;

  const countLabel = freeOnly
    ? `${daySlots.length} ${daySlots.length === 1 ? 'free slot' : 'free slots'}`
    : timedEvents.length > 0
      ? `${timedEvents.length} ${timedEvents.length === 1 ? 'meeting' : 'meetings'}`
      : daySlots.length > 0
        ? `${daySlots.length} ${daySlots.length === 1 ? 'open slot' : 'open slots'}`
        : 'Nothing scheduled';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 6 * HOUR_HEIGHT - 10;
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [dayKey]);

  return (
    <div className="overflow-x-auto">
      <div className="flex h-[calc(100vh-300px)] min-h-[480px] min-w-[520px] flex-col">
        <div className="flex items-stretch border-b pr-2">
          <TimeScaleHeader primaryTz={primaryTz} secondaryTz={secondaryTz} />

          <div
            className={`flex flex-1 items-center justify-between gap-3 border-l px-3 py-2 ${
              weekend ? WEEKEND_TINT : ''
            }`}
          >
            <span className="text-sm font-semibold text-foreground">
              {format.dateTime(dateKeyToUtcDate(dayKey), {
                timeZone: 'UTC',
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </span>

            <span className="text-[11px] font-medium text-muted-foreground">{countLabel}</span>
          </div>
        </div>

        {hasAllDay ? (
          <div className="flex border-b bg-muted/30 pr-2">
            <div className="flex w-16 shrink-0 items-center justify-end border-r px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              All-day
            </div>

            <div
              className={`flex min-h-9 flex-1 flex-col gap-1 border-l px-2 py-1.5 ${
                weekend ? WEEKEND_TINT : ''
              }`}
            >
              {allDayEvents.map((event) => (
                <AllDayChip key={`${event.id}-${event.start}`} event={event} />
              ))}
            </div>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="flex flex-1 items-start overflow-y-auto overflow-x-hidden"
        >
          <TimeScaleColumns
            sampleDayKey={dayKey}
            primaryTz={primaryTz}
            secondaryTz={secondaryTz}
          />

          <DayColumn
            dayKey={dayKey}
            weekend={weekend}
            events={timedEvents}
            slots={daySlots}
            selectedEventId={selectedEventId}
            onSelectEvent={onSelectEvent}
            primaryTz={primaryTz}
            secondaryTz={secondaryTz}
          />
        </div>
      </div>
    </div>
  );
}
