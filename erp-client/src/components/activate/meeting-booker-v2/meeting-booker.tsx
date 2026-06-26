'use client';

// Meeting Booker (v2) — the Saloot week time-grid calendar, wired to the org's REAL
// Google Calendar(s). It now reads EVERY connected mailbox (not just the default):
// an account toggle row filters to "All" or one account; each account gets a color
// (the one place the otherwise black-and-white UI uses color) shown as a numbered
// circle in the toggle and as the LEFT BORDER of that account's meeting cards.
// Clicking a meeting opens a detail/edit dialog that writes back to that mailbox's
// Google Calendar event.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { CalendarEventDto } from '@evertrust/shared';
import { api } from '@/lib/api';
import { useGoogleAccounts } from '@/hooks/use-arsenal';
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
import {
  MeetingDetailDialog,
  type AccountEvent,
} from './meeting-detail-dialog';

const HOUR_PX = 56;
const DAY_HOURS = 24;
const WORK_DAYS = 5; // Mon–Fri
const OPEN_SCROLL_TOP = 7 * HOUR_PX - 10;

const HOUR_LABELS = Array.from({ length: DAY_HOURS }, (_, n) =>
  n === 0 ? '12 AM' : n < 12 ? `${n} AM` : n === 12 ? '12 PM' : `${n - 12} PM`,
);

// Fallback palette for accounts with no DB color yet (assigned by index). These are
// the ONLY colors in the app — everything else stays black & white.
const ACCOUNT_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#d97706',
  '#7c3aed',
  '#0891b2',
];

type AccountMeta = {
  id: string;
  email: string;
  color: string;
  number: number;
};

type EventPosition = {
  event: AccountEvent;
  top: number;
  time: string;
  detail: string;
  color: string;
};

function weekdayShort(dateKey: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
    .format(dateKeyToUtcDate(dateKey))
    .toUpperCase();
}

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
  const [mondayKey, setMondayKey] = useState(() =>
    startOfWorkWeekKey(new Date(), DEFAULT_TIME_ZONE),
  );
  // '' = All accounts; otherwise a specific connected account id.
  const [accountFilter, setAccountFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<AccountEvent | null>(null);

  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Connected mailboxes, each given a stable color + number for the toggle/border.
  const accountsQuery = useGoogleAccounts();
  const accounts = useMemo<AccountMeta[]>(() => {
    const connected = (accountsQuery.data ?? []).filter(
      (a) => a.status === 'CONNECTED',
    );
    return connected.map((a, i) => ({
      id: a.id,
      email: a.email,
      color: a.color ?? ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length]!,
      number: i + 1,
    }));
  }, [accountsQuery.data]);

  const colorByAccount = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.id, a.color));
    return map;
  }, [accounts]);

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

  // Fetch each connected mailbox's calendar in parallel and tag every event with
  // its accountId, so we can color + filter by account. One query keyed on the
  // visible range + the set of accounts.
  const accountIds = accounts.map((a) => a.id);
  const calQuery = useQuery({
    queryKey: ['activate', 'calendar', 'multi', range, accountIds],
    enabled: accounts.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const perAccount = await Promise.all(
        accounts.map(async (a) => {
          const data = await api.meetings.calendarUpcoming(
            { ...range, accountId: a.id },
            signal,
          );
          const events: AccountEvent[] = (data.events ?? []).map((e) => ({
            ...e,
            accountId: a.id,
          }));
          return { timeZone: data.timeZone, configured: data.configured, events };
        }),
      );
      return {
        timeZone: perAccount[0]?.timeZone ?? DEFAULT_TIME_ZONE,
        configured: perAccount.some((r) => r.configured),
        events: perAccount.flatMap((r) => r.events),
      };
    },
  });

  const primaryTz = calQuery.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const configured = Boolean(calQuery.data?.configured);
  const weekNumber = getIsoWeekNumber(mondayKey);
  const rangeText = weekRangeLabel(mondayKey);

  const days = useMemo(
    () => Array.from({ length: WORK_DAYS }, (_, i) => addDaysToDateKey(mondayKey, i)),
    [mondayKey],
  );

  // Parsed, account-filtered events.
  const events = useMemo(
    () =>
      (calQuery.data?.events ?? [])
        .filter((event) => !event.allDay)
        .filter((event) => !accountFilter || event.accountId === accountFilter)
        .map((event) => ({
          event,
          startDate: new Date(event.start),
          endDate: new Date(event.end),
        }))
        .filter((row) => isValidDate(row.startDate) && isValidDate(row.endDate)),
    [calQuery.data?.events, accountFilter],
  );

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
            color: colorByAccount.get(row.event.accountId) ?? '#15171c',
          };
        })
        .sort((a, b) => a.top - b.top),
    );
  }, [days, events, primaryTz, colorByAccount]);

  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = OPEN_SCROLL_TOP;
  }, [mondayKey, calQuery.data]);

  // Google-Calendar-style keyboard nav: `n` → next week, `p` → previous week.
  // Ignored while typing in a field or when a modifier is held, so it never
  // hijacks shortcuts or text entry.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        setMondayKey((k) => addDaysToDateKey(k, 7));
      } else if (key === 'p') {
        e.preventDefault();
        setMondayKey((k) => addDaysToDateKey(k, -7));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
                title="Previous week (P)"
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
                title="Next week (N)"
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
                href="/settings/general"
                className="inline-flex items-center gap-[7px] rounded-[20px] border border-[#d6dade] px-[11px] py-[5px] text-[10.5px] font-bold text-[#5b626d] hover:bg-[#f6f7f9]"
              >
                <span className="h-[7px] w-[7px] rounded-full bg-[#959ca7]" />
                CONNECT GOOGLE CALENDAR
              </Link>
            )}
          </div>
        </div>

        {/* Account filter toggle row — "All" + one chip per connected account, each
            with its numbered color circle. Only shown when 2+ accounts exist. */}
        {accounts.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#e4e7eb] px-4 py-[10px]">
            <button
              type="button"
              onClick={() => setAccountFilter('')}
              className={[
                'rounded-[7px] border px-[11px] py-[5px] text-[11px] font-bold transition-colors',
                accountFilter === ''
                  ? 'border-[#15171c] bg-[#15171c] text-white'
                  : 'border-[#d6dade] bg-white text-[#5b626d] hover:border-[#15171c]',
              ].join(' ')}
            >
              All meetings
            </button>
            {accounts.map((a) => {
              const active = accountFilter === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccountFilter(a.id)}
                  title={a.email}
                  className={[
                    'inline-flex items-center gap-[7px] rounded-[7px] border px-[10px] py-[5px] text-[11px] font-bold transition-colors',
                    active
                      ? 'border-[#15171c] text-[#15171c]'
                      : 'border-[#d6dade] text-[#5b626d] hover:border-[#15171c]',
                  ].join(' ')}
                >
                  <span
                    className="grid h-[16px] w-[16px] place-items-center rounded-full text-[9px] font-bold text-white"
                    style={{ backgroundColor: a.color }}
                  >
                    {a.number}
                  </span>
                  <span className="max-w-[160px] truncate">{a.email}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Body: header row (gutter + day columns) + scrolling time grid */}
        <div className="flex p-0">
          <div className="flex h-[calc(100vh-300px)] min-h-[360px] w-full flex-col">
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

            <div
              ref={bodyRef}
              className="flex min-h-0 flex-1 items-start overflow-y-auto overflow-x-hidden py-[10px] [scrollbar-gutter:stable]"
            >
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

              {days.map((dayKey, i) => (
                <div
                  key={dayKey}
                  className="relative flex flex-1 flex-col overflow-hidden border-b border-l border-[#e4e7eb]"
                >
                  {Array.from({ length: DAY_HOURS }, (_, r) => (
                    <div key={r} className="h-[56px] flex-none border-t border-[#e4e7eb]" />
                  ))}

                  {(eventsByDay[i] ?? []).map((pos) => (
                    <button
                      key={pos.event.id}
                      type="button"
                      onClick={() => setSelectedEvent(pos.event)}
                      className="absolute left-[5px] right-[5px] z-[1] cursor-pointer overflow-hidden rounded-[6px] border border-l-2 border-[#d6dade] bg-[#eceef1] px-[7px] py-[3px] text-left transition-opacity hover:opacity-80"
                      style={{ top: pos.top, height: HOUR_PX, borderLeftColor: pos.color }}
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
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <MeetingDetailDialog
        event={selectedEvent}
        accountEmail={
          accounts.find((a) => a.id === selectedEvent?.accountId)?.email ?? ''
        }
        accountColor={
          selectedEvent ? colorByAccount.get(selectedEvent.accountId) ?? '#15171c' : '#15171c'
        }
        onClose={() => setSelectedEvent(null)}
        onSaved={() => calQuery.refetch()}
      />
    </div>
  );
}
