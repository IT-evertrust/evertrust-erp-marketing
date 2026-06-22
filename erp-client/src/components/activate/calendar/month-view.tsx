'use client';

import { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  dateKeyToUtcDate,
  getZonedParts,
  monthGridDays,
  overlapsDateKey,
  parseDateKey,
  toDateKey,
} from '@/components/activate/calendar/time-grid';
import { CATEGORY_STYLE } from '@/components/activate/calendar/event-category';
import { isWeekendDateKey } from '@/components/activate/calendar/time-gutter';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  CalendarGridEvent,
  CalendarGridSlot,
} from '@/components/activate/calendar/types';

const MAX_CHIPS = 2;
const WEEKDAY_SAMPLE_KEYS = [
  // Any Mon–Sun run; used only to render localized weekday short names in the header.
  '2024-01-01', // Monday
  '2024-01-02',
  '2024-01-03',
  '2024-01-04',
  '2024-01-05',
  '2024-01-06', // Saturday
  '2024-01-07', // Sunday
];

// Calendar-month grid (Mon-start, 6 rows). No time gutter: each cell buckets the
// (already campaign-filtered) events and counts that day's free slots. Clicking a
// cell switches the parent to Day view for that date.
export function MonthView({
  anchorKey,
  events,
  slots,
  primaryTz,
  onDayClick,
  freeOnly = false,
  loading = false,
}: {
  anchorKey: string;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
  primaryTz: string;
  onDayClick: (dateKey: string) => void;
  freeOnly?: boolean;
  loading?: boolean;
}) {
  const format = useFormatter();

  const cells = useMemo(() => monthGridDays(anchorKey, primaryTz), [anchorKey, primaryTz]);

  // Today in the org's render zone, so the highlight tracks the org's calendar day.
  const todayKey = useMemo(() => {
    const parts = getZonedParts(new Date(), primaryTz);
    return toDateKey(parts.year, parts.month, parts.day);
  }, [primaryTz]);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAY_SAMPLE_KEYS.map((sampleKey, index) => (
          <div
            key={sampleKey}
            className={`px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${
              index >= 5 ? 'bg-white/[.02]' : ''
            }`}
          >
            {format.dateTime(dateKeyToUtcDate(sampleKey), {
              timeZone: 'UTC',
              weekday: 'short',
            })}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell) => (
          <MonthCell
            key={cell.dateKey}
            dateKey={cell.dateKey}
            inMonth={cell.inMonth}
            isToday={cell.dateKey === todayKey}
            events={events}
            slots={slots}
            primaryTz={primaryTz}
            onDayClick={onDayClick}
            freeOnly={freeOnly}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCell({
  dateKey,
  inMonth,
  isToday,
  events,
  slots,
  primaryTz,
  onDayClick,
  freeOnly,
  loading,
}: {
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
  events: CalendarGridEvent[];
  slots: CalendarGridSlot[];
  primaryTz: string;
  onDayClick: (dateKey: string) => void;
  freeOnly: boolean;
  loading: boolean;
}) {
  const t = useTranslations('activate');
  const dayNumber = parseDateKey(dateKey).day;
  const weekend = isWeekendDateKey(dateKey);

  const dayEvents = useMemo(
    () =>
      events.filter((event) =>
        overlapsDateKey(event.startDate, event.endDate, dateKey, primaryTz),
      ),
    [events, dateKey, primaryTz],
  );

  const freeCount = useMemo(
    () =>
      slots.filter((slot) => overlapsDateKey(slot.start, slot.end, dateKey, primaryTz)).length,
    [slots, dateKey, primaryTz],
  );

  const chips = freeOnly ? [] : dayEvents.slice(0, MAX_CHIPS);
  const overflow = freeOnly ? 0 : Math.max(0, dayEvents.length - MAX_CHIPS);

  // In free-slot mode, days without an opening recede so the bookable days pop.
  const dimmedForFree = freeOnly && freeCount === 0;

  return (
    <button
      type="button"
      onClick={() => onDayClick(dateKey)}
      aria-label={t('calendar.day.aria', {
        date: dateKey,
        events: dayEvents.length,
        free: freeCount,
      })}
      className={[
        'flex min-h-24 flex-col gap-1 border-b border-l p-1.5 text-left transition-colors',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        weekend ? 'bg-white/[.02]' : '',
        !inMonth ? 'opacity-40' : '',
        dimmedForFree ? 'opacity-30' : '',
      ].join(' ')}
    >
      <span
        className={[
          'flex size-6 items-center justify-center self-start rounded-full text-[11px] font-medium tabular-nums',
          isToday
            ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500'
            : 'text-muted-foreground',
        ].join(' ')}
      >
        {dayNumber}
      </span>

      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        {loading ? (
          // Placeholder chips while meetings fetch; the cell frame stays put.
          <>
            <Skeleton className="h-3.5 w-full rounded" />
            <Skeleton className="h-3.5 w-2/3 rounded" />
          </>
        ) : (
          <>
            {chips.map((event) => {
              const style = CATEGORY_STYLE[event.category];
              const title = event.title || t('calendar.event.untitled');

              return (
                <span
                  key={`${event.id}-${event.start}`}
                  className={`truncate rounded border-l-2 bg-popover px-1 py-0.5 text-[10px] font-medium ${style.bar} ${style.tint}`}
                  title={title}
                >
                  {title}
                </span>
              );
            })}

            {overflow > 0 ? (
              <span className="px-1 text-[10px] font-medium text-muted-foreground">
                {t('calendar.month.more', { count: overflow })}
              </span>
            ) : null}
          </>
        )}
      </div>

      {!loading && freeOnly && freeCount > 0 ? (
        <span className="self-start rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
          {t('calendar.month.free', { count: freeCount })}
        </span>
      ) : null}
    </button>
  );
}
