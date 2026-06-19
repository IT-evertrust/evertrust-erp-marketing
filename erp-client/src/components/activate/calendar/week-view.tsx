'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFormatter } from 'next-intl';
import {
  HOUR_HEIGHT,
  HOURS,
  dateKeyToUtcDate,
  formatClockInTimeZone,
  overlapsDateKey,
  zoneShortLabel,
  zonedTimeToUtcDate,
} from '@/components/activate/calendar/time-grid';
import { CalendarEventBlock, layoutDayEvents } from '@/components/activate/calendar/event-block';
import { CalendarSlotBlock } from '@/components/activate/calendar/slot-block';
import { CATEGORY_STYLE } from '@/components/activate/calendar/event-category';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
} from '@/components/activate/calendar/types';

// A weekday index ≥ 5 (Sat/Sun) given the grid starts on Monday — used to tint
// the weekend columns and headers.
function isWeekendIndex(index: number): boolean {
  return index >= 5;
}

const WEEKEND_TINT = 'bg-white/[.02]';

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
}) {
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

        {hasAllDay ? (
          <div className="flex border-b bg-muted/30 pr-2">
            <div className="flex w-16 shrink-0 items-center justify-end border-r px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              All-day
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
              slots={slots.filter((slot) =>
                overlapsDateKey(slot.start, slot.end, dayKey, primaryTz),
              )}
              selectedEventId={selectedEventId}
              onSelectEvent={onSelectEvent}
              primaryTz={primaryTz}
              secondaryTz={secondaryTz}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AllDayChip({ event }: { event: CalendarGridEvent }) {
  const style = CATEGORY_STYLE[event.category];
  const title = event.title || 'Untitled';

  return (
    <span
      className={`truncate rounded border-l-4 bg-popover px-1.5 py-0.5 text-[10px] font-semibold ${style.bar} ${style.tint}`}
      title={title}
    >
      {title}
    </span>
  );
}

// Gutter header. Dual-scale (org has a secondary zone): secondary on the left,
// primary on the right. Single-scale (secondary null): one primary column. Labels
// are derived from each IANA zone (e.g. "GMT+2"), never hardcoded.
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
            <div
              key={`primary-${label.hour}`}
              className={labelCell}
              style={{ top: label.hour * HOUR_HEIGHT }}
            >
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
          <div
            key={`secondary-${label.hour}`}
            className={labelCell}
            style={{ top: label.hour * HOUR_HEIGHT }}
          >
            {label.secondary}
          </div>
        ))}
      </div>

      <div className="relative">
        {labels.map((label) => (
          <div
            key={`primary-${label.hour}`}
            className={labelCell}
            style={{ top: label.hour * HOUR_HEIGHT }}
          >
            {label.primary}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  dayKey,
  weekend,
  events,
  slots,
  selectedEventId,
  onSelectEvent,
  primaryTz,
  secondaryTz,
}: {
  dayKey: string;
  weekend: boolean;
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
      className={`relative flex flex-1 flex-col overflow-hidden border-l border-b ${
        weekend ? WEEKEND_TINT : ''
      }`}
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
