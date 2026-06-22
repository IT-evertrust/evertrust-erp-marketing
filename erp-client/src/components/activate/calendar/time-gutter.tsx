'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  HOUR_HEIGHT,
  HOURS,
  formatClockInTimeZone,
  zoneShortLabel,
  zonedTimeToUtcDate,
} from '@/components/activate/calendar/time-grid';
import { CalendarEventBlock, layoutDayEvents } from '@/components/activate/calendar/event-block';
import { CalendarSlotBlock } from '@/components/activate/calendar/slot-block';
import { CATEGORY_STYLE } from '@/components/activate/calendar/event-category';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
} from '@/components/activate/calendar/types';

// Weekend tint shared by Week and Day grids — kept in one place so both views
// stay visually identical.
export const WEEKEND_TINT = 'bg-white/[.02]';

// A weekday index ≥ 5 (Sat/Sun) given the grid starts on Monday — used to tint
// the weekend columns and headers in the Week view.
export function isWeekendIndex(index: number): boolean {
  return index >= 5;
}

// True when the date key is Sat/Sun in UTC (date keys are zone-agnostic calendar
// days), used by the single-column Day view and the Month grid.
export function isWeekendDateKey(dateKey: string): boolean {
  const parts = dateKey.split('-');
  const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// All-day chip for the strip above the time grid (Week/Day). Colored by category.
export function AllDayChip({ event }: { event: CalendarGridEvent }) {
  const t = useTranslations('activate');
  const style = CATEGORY_STYLE[event.category];
  const title = event.title || t('calendar.event.untitled');

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
export function TimeScaleHeader({
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

// Hour labels down the left gutter, dual or single scale. Heights are driven by
// HOUR_HEIGHT so the labels stay aligned with the grid rows in both views.
export function TimeScaleColumns({
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

  // Labels sit just BELOW each hour rule line (top-anchored), so they read inside
  // their hour row and the very first label (top of the grid) is never clipped by
  // the scroll edge. `top` matches the day-column gridlines (hour * HOUR_HEIGHT).
  const labelCell =
    'absolute right-2 whitespace-nowrap text-[10px] font-medium leading-none text-muted-foreground';
  const labelTop = (hour: number) => hour * HOUR_HEIGHT + 4;

  if (!secondaryTz) {
    return (
      <div className="w-16 shrink-0" style={{ height: HOURS.length * HOUR_HEIGHT }}>
        <div className="relative border-r">
          {labels.map((label) => (
            <div
              key={`primary-${label.hour}`}
              className={labelCell}
              style={{ top: labelTop(label.hour) }}
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

// A single day's timed column: hour rule lines, free-slot blocks, and positioned
// event blocks. Shared verbatim between Week (7 narrow columns) and Day (one
// full-width column) so the grid + positioning math lives in exactly one place.
export function DayColumn({
  dayKey,
  weekend,
  events,
  slots,
  selectedEventId,
  onSelectEvent,
  primaryTz,
  secondaryTz,
  loading = false,
}: {
  dayKey: string;
  weekend: boolean;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarGridEvent) => void;
  primaryTz: string;
  secondaryTz: string | null;
  loading?: boolean;
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
        <div key={hour} className="shrink-0 border-t" style={{ height: HOUR_HEIGHT }} />
      ))}

      {/* While fetching, overlay a couple of placeholder blocks within the business-
          hours band so the cells read as "loading" without disturbing the grid frame
          (the hour rule lines above stay put). */}
      {loading ? (
        <div className="pointer-events-none absolute inset-x-1 flex flex-col gap-2"
          style={{ top: 9 * HOUR_HEIGHT }}
        >
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ) : null}

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
