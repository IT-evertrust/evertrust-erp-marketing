'use client';

// Meeting Booker (v2) — a faithful port of the Saloot demo's week time-grid
// calendar (the `.calcard` markup). It is a NEW, self-contained component: it does
// NOT touch or replace the existing full-featured `components/activate/calendar`
// Calendar — that code stays intact. This one mirrors the HTML design exactly
// (light grayscale palette, 58px gutter + 5 Mon–Fri columns, 24×56px hour rows,
// events absolutely positioned by start time, ‹ week-range › nav, connected pill)
// while being wired to the org's REAL Google Calendar via useCalendarUpcoming.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { CalendarEventDto } from '@evertrust/shared';
import { useCalendarUpcoming } from '@/hooks/use-meetings';
import {
  DEFAULT_TIME_ZONE,
  addDaysToDateKey,
  dateKeyToUtcDate,
  formatClockInTimeZone,
  getIsoWeekNumber,
  getVisualRangeForDateKey,
  isValidDate,
  overlapsDateKey,
  parseDateKey,
  startOfWorkWeekKey,
  zoneShortLabel,
  zonedTimeToUtcDate,
} from '@/components/activate/calendar/time-grid';

// One pixel-per-hour scale lifted straight from the HTML (`.daycol .hrow{height:56px}`),
// with the 7 AM auto-scroll the demo opens at (`scrollTop = 7*56 - 10`).
const HOUR_PX = 56;
const DAY_HOURS = 24;
const WORK_DAYS = 5; // Mon–Fri
const OPEN_SCROLL_TOP = 7 * HOUR_PX - 10;

// 24 hour labels: "12 AM", "1 AM", …, "12 PM", "1 PM", …  (HTML's tlab logic).
const HOUR_LABELS = Array.from({ length: DAY_HOURS }, (_, n) =>
  n === 0 ? '12 AM' : n < 12 ? `${n} AM` : n === 12 ? '12 PM' : `${n - 12} PM`,
);

type EventPosition = {
  event: CalendarEventDto;
  top: number;
  time: string;
  detail: string;
};

// Short weekday name for a YYYY-MM-DD key, rendered from a noon-UTC anchor so the
// label can never slip a day across the zone boundary.
function weekdayShort(dateKey: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
  })
    .format(dateKeyToUtcDate(dateKey))
    .toUpperCase();
}

// "16 – 20 Jun" (month shown once when the week stays in one month, else on both).
function weekRangeLabel(mondayKey: string): string {
  const fridayKey = addDaysToDateKey(mondayKey, WORK_DAYS - 1);
  const start = parseDateKey(mondayKey);
  const end = parseDateKey(fridayKey);

  const monthOf = (key: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(
      dateKeyToUtcDate(key),
    );

  if (start.month === end.month) {
    return `${start.day} – ${end.day} ${monthOf(fridayKey)}`;
  }

  return `${start.day} ${monthOf(mondayKey)} – ${end.day} ${monthOf(fridayKey)}`;
}

export function MeetingBookerV2() {
  // Anchor = Monday of the visible work week; defaults to the current week.
  const [mondayKey, setMondayKey] = useState(() =>
    startOfWorkWeekKey(new Date(), DEFAULT_TIME_ZONE),
  );

  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Fetch the visible week buffered ±1 day so nothing clips at the zone edge. The
  // fetch zone only tags the request; the org's resolved zone drives rendering.
  const range = useMemo(() => {
    const timeMin = zonedTimeToUtcDate(
      addDaysToDateKey(mondayKey, -1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );
    const timeMax = zonedTimeToUtcDate(
      addDaysToDateKey(mondayKey, WORK_DAYS + 1),
      0,
      0,
      DEFAULT_TIME_ZONE,
    );

    return {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: DEFAULT_TIME_ZONE,
    };
  }, [mondayKey]);

  const upcoming = useCalendarUpcoming(range);

  const primaryTz = upcoming.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const configured = Boolean(upcoming.data?.configured);
  const weekNumber = getIsoWeekNumber(mondayKey);
  const rangeText = weekRangeLabel(mondayKey);

  // The five Mon–Fri day keys for the visible week.
  const days = useMemo(
    () => Array.from({ length: WORK_DAYS }, (_, i) => addDaysToDateKey(mondayKey, i)),
    [mondayKey],
  );

  // Real events parsed once; reused per-day below.
  const events = useMemo(
    () =>
      (upcoming.data?.events ?? [])
        .filter((event) => !event.allDay)
        .map((event) => ({
          event,
          startDate: new Date(event.start),
          endDate: new Date(event.end),
        }))
        .filter((row) => isValidDate(row.startDate) && isValidDate(row.endDate)),
    [upcoming.data?.events],
  );

  // For each day, the events that fall on it, positioned by their start minute.
  const eventsByDay = useMemo<EventPosition[][]>(() => {
    return days.map((dayKey) =>
      events
        .filter((row) => overlapsDateKey(row.startDate, row.endDate, dayKey, primaryTz))
        .map((row) => {
          const visual = getVisualRangeForDateKey(
            row.startDate,
            row.endDate,
            dayKey,
            primaryTz,
          );
          const attendees = row.event.attendees ?? [];
          const detail =
            attendees.length > 0
              ? attendees.join(', ')
              : (row.event.location ?? '').trim();

          return {
            event: row.event,
            top: (visual.startMinute / 60) * HOUR_PX,
            time: formatClockInTimeZone(row.startDate, primaryTz),
            detail,
          };
        })
        .sort((a, b) => a.top - b.top),
    );
  }, [days, events, primaryTz]);

  // Open the grid scrolled to ~7 AM (working hours), re-applied whenever the week
  // changes or the data finishes loading.
  useEffect(() => {
    const node = bodyRef.current;
    if (node) {
      node.scrollTop = OPEN_SCROLL_TOP;
    }
  }, [mondayKey, upcoming.data]);

  return (
    <div className="pt-[18px]">
      <div className="flex flex-col rounded-[10px] border border-[#e4e7eb] bg-white text-[#15171c]">
        {/* Head: title + week nav + connected pill */}
        <div className="flex items-center justify-between border-b border-[#e4e7eb] px-4 py-[15px]">
          <h3 className="text-[13.5px] font-bold text-[#15171c]">
            Calendar · Week {weekNumber}
          </h3>

          <div className="flex items-center gap-[14px]">
            <div className="flex items-center gap-[10px]">
              <button
                type="button"
                aria-label="Previous week"
                onClick={() => setMondayKey((key) => addDaysToDateKey(key, -7))}
                className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#d6dade] bg-white text-[15px] font-bold leading-none text-[#15171c] hover:bg-[#f6f7f9]"
              >
                ‹
              </button>
              <span className="min-w-[84px] text-center text-[11px] font-bold tracking-[0.04em] text-[#5b626d]">
                {rangeText}
              </span>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => setMondayKey((key) => addDaysToDateKey(key, 7))}
                className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#d6dade] bg-white text-[15px] font-bold leading-none text-[#15171c] hover:bg-[#f6f7f9]"
              >
                ›
              </button>
            </div>

            {configured ? (
              <span className="inline-flex items-center gap-[7px] rounded-[20px] border border-[#d6dade] px-[11px] py-[5px] text-[10.5px] font-bold text-[#5b626d]">
                <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-[#15171c]" />
                GOOGLE CALENDAR CONNECTED
              </span>
            ) : (
              <Link
                href="/settings/configuration"
                className="inline-flex items-center gap-[7px] rounded-[20px] border border-[#d6dade] px-[11px] py-[5px] text-[10.5px] font-bold text-[#5b626d] hover:bg-[#f6f7f9]"
              >
                <span className="h-[7px] w-[7px] rounded-full bg-[#959ca7]" />
                CONNECT GOOGLE CALENDAR
              </Link>
            )}
          </div>
        </div>

        {/* Body: header row (gutter + day columns) + scrolling time grid */}
        <div className="flex p-0">
          <div className="flex h-[calc(100vh-300px)] min-h-[360px] w-full flex-col">
            {/* Day header row */}
            <div className="flex flex-none border-b border-[#e4e7eb] pr-[9px]">
              <div className="flex w-[58px] flex-none items-end justify-end pb-[7px] pr-2 text-[9.5px] font-bold tracking-[0.06em] text-[#959ca7]">
                {zoneShortLabel(primaryTz)}
              </div>
              {days.map((dayKey, i) => {
                const count = eventsByDay[i]?.length ?? 0;
                const day = parseDateKey(dayKey).day;
                return (
                  <div
                    key={dayKey}
                    className="flex flex-1 flex-col gap-[2px] border-l border-[#e4e7eb] py-2 text-center"
                  >
                    <span className="text-[10px] font-bold tracking-[0.08em] text-[#5b626d]">
                      {weekdayShort(dayKey)} {day}
                    </span>
                    <span className="text-[9px] font-bold tracking-[0.04em] text-[#959ca7]">
                      {count === 0
                        ? 'free'
                        : `${count} ${count > 1 ? 'meetings' : 'meeting'}`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Scrolling time grid */}
            <div
              ref={bodyRef}
              className="flex min-h-0 flex-1 items-start overflow-y-auto overflow-x-hidden py-[10px] [scrollbar-gutter:stable]"
            >
              {/* Hour gutter */}
              <div className="relative w-[58px] flex-none" style={{ height: DAY_HOURS * HOUR_PX }}>
                {HOUR_LABELS.map((label, n) => (
                  <div
                    key={label}
                    className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[9.5px] font-bold text-[#959ca7]"
                    style={{ top: n * HOUR_PX }}
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {days.map((dayKey, i) => (
                <div
                  key={dayKey}
                  className="relative flex flex-1 flex-col overflow-hidden border-b border-l border-[#e4e7eb]"
                >
                  {Array.from({ length: DAY_HOURS }, (_, r) => (
                    <div key={r} className="h-[56px] flex-none border-t border-[#e4e7eb]" />
                  ))}

                  {(eventsByDay[i] ?? []).map((pos) => (
                    <div
                      key={pos.event.id}
                      className="absolute left-[5px] right-[5px] z-[1] overflow-hidden rounded-[6px] border border-[#d6dade] border-l-2 border-l-[#15171c] bg-[#eceef1] px-[7px] py-[3px]"
                      style={{ top: pos.top, height: HOUR_PX }}
                      title={`${pos.time} · ${pos.event.title}${pos.detail ? ` · ${pos.detail}` : ''}`}
                    >
                      <div className="text-[9px] font-bold leading-[1.25] text-[#959ca7]">
                        {pos.time}
                      </div>
                      <div className="truncate text-[10.5px] font-bold leading-[1.3] text-[#15171c]">
                        {pos.event.title}
                      </div>
                      {pos.detail ? (
                        <div className="truncate text-[9.5px] leading-[1.3] text-[#959ca7]">
                          {pos.detail}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
