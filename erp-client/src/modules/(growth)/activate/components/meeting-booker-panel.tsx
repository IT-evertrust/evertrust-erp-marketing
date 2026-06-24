'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { GrowthCard, LiveDot, Spinner } from '@/modules/(growth)/shared';

import {
  moveMeeting,
  requestToJoinMeeting,
  updateMeeting,
} from '../services/activate-service';
import type { CalendarMeeting, MeetingAccount } from '../types';

type MeetingBookerPanelProps = {
  accounts: MeetingAccount[];
  accountId: string;
  onSelectAccount: (accountId: string) => void;
  loadingAccounts: boolean;
  meetings: CalendarMeeting[];
  loadingMeetings: boolean;
  // Re-pull the calendar after an edit / move.
  onMeetingChanged: () => void;
};

// Calendar grid geometry. Wider hour range (7 AM–9 PM) + taller rows so slots breathe
// and the body scrolls vertically through the day. Event positioning derives from these,
// so changing them keeps grid + events in sync.
const DAY_START = 7; // first hour shown (7 AM)
const DAY_END = 21; // last hour shown (9 PM)
const ROW_H = 80; // px per hour row (was 56 — more space, less clutter)
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MS_DAY = 86_400_000;
const YEAR_MS = 365 * MS_DAY;

const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Monday of the week containing `d`.
function mondayOf(d: Date): Date {
  const m = startOfDay(d);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  m.setDate(m.getDate() - dow);
  return m;
}

// Sunday of the week containing `d` (the calendar renders a Sun–Sat 7-day week).
function sundayOf(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay()); // getDay(): 0 = Sunday
  return s;
}

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const firstOfMonth = (d: Date, monthDelta: number): Date =>
  new Date(d.getFullYear(), d.getMonth() + monthDelta, 1);

// Keep navigation within ±1 year of today (the calendar window the backend fetches).
function clampToYear(d: Date): Date {
  const now = Date.now();
  if (d.getTime() < now - YEAR_MS) return new Date(now - YEAR_MS);
  if (d.getTime() > now + YEAR_MS) return new Date(now + YEAR_MS);
  return d;
}

// The five weekday Date objects (Mon–Fri) of the week containing `anchor`.
function weekDates(anchor: Date): Date[] {
  const sunday = sundayOf(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

const dayLabel = (d: Date): string => `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;

// True when an event's ISO start falls on calendar day `d` (local time).
function sameDay(iso: string | null | undefined, d: Date): boolean {
  if (!iso) return false;
  const m = new Date(iso);
  return (
    m.getFullYear() === d.getFullYear() &&
    m.getMonth() === d.getMonth() &&
    m.getDate() === d.getDate()
  );
}

const monthYearLabel = (d: Date): string =>
  mondayOf(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// ISO-8601 week number of the week containing `d` (mock shows "Calendar · Week 25").
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

// "Jun 23 – 27" / "Jun 30 – Jul 4" for the visible Mon–Fri span.
function weekRangeLabel(dates: Date[]): string {
  const a = dates[0];
  const b = dates[dates.length - 1];
  if (!a || !b) return '';
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right =
    a.getMonth() === b.getMonth()
      ? `${b.getDate()}`
      : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${left} – ${right}`;
}

export function MeetingBookerPanel({
  accounts,
  accountId,
  onSelectAccount,
  loadingAccounts,
  meetings,
  loadingMeetings,
  onMeetingChanged,
}: MeetingBookerPanelProps) {
  const [openMeeting, setOpenMeeting] = useState<CalendarMeeting | null>(null);
  // Anchor date for the visible week. Navigation moves it by week or month, clamped to
  // ±1 year — the window the backend now fetches — so every view has real data.
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  const dates = weekDates(viewDate);
  const isThisWeek = sundayOf(viewDate).getTime() === sundayOf(new Date()).getTime();
  const go = (next: Date) => setViewDate(clampToYear(next));
  // Events on a given day: by real start date, falling back to the day-label for any
  // DB-seeded meeting that lacks an ISO start.
  const eventsFor = (d: Date) =>
    meetings.filter(
      (m) => sameDay(m.startsAt, d) || (!m.startsAt && m.day === dayLabel(d)),
    );
  // How many meetings fall in the currently visible Mon–Fri week.
  const weekMeetingCount = dates.reduce((n, d) => n + eventsFor(d).length, 0);
  // While accounts (or the first meetings load) are in flight, show a loading state
  // INSTEAD of an empty grid — otherwise the calendar box renders blank mid-load.
  const isLoading = loadingAccounts || (loadingMeetings && meetings.length === 0);

  // Google-Calendar-style keyboard nav: N = next week, P = previous week. Ignored
  // while typing in a field or with the meeting popup open / a modifier held.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || openMeeting) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) {
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setViewDate((d) => clampToYear(addDays(d, 7)));
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setViewDate((d) => clampToYear(addDays(d, -7)));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openMeeting]);

  return (
    <GrowthCard
      title={`Calendar · Week ${isoWeek(viewDate)}`}
      hint={
        <span className="inline-flex items-center gap-2">
          <LiveDot />
          Booked meetings
        </span>
      }
    >
      {/* Email-account toggle (interchangeable, like Engage's inbox switch) */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
          Account
        </span>
        {accounts.length > 0 ? (
          <>
            <select
              value={accountId}
              onChange={(event) => onSelectAccount(event.target.value)}
              className="rounded-[8px] border border-[#e4e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#15171c]"
            >
              {accounts.length > 1 ? (
                <option value="all">All accounts</option>
              ) : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </select>

            {/* Color legend — which hue belongs to which account. */}
            {accounts.length > 1 ? (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {accounts.map((account) => (
                  <span
                    key={account.id}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-[#5b626d]"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: account.color ?? '#15171c' }}
                    />
                    {account.email.split('@')[0]}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-[12px] text-[#959ca7]">
            {loadingAccounts ? 'Loading accounts…' : 'No meetings yet'}
          </span>
        )}

        {/* Navigation: month stepper + week stepper + Today (all within ±1 year) */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Month stepper */}
          <div className="flex items-center rounded-[8px] border border-[#e4e7eb] bg-white">
            <button
              type="button"
              onClick={() => go(firstOfMonth(viewDate, -1))}
              className="px-2.5 py-1.5 text-[12px] font-bold text-[#15171c] hover:bg-[#f6f7f9]"
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="min-w-[104px] px-1 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-[#15171c]">
              {monthYearLabel(viewDate)}
            </span>
            <button
              type="button"
              onClick={() => go(firstOfMonth(viewDate, 1))}
              className="px-2.5 py-1.5 text-[12px] font-bold text-[#15171c] hover:bg-[#f6f7f9]"
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <button
            type="button"
            onClick={() => setViewDate(new Date())}
            disabled={isThisWeek}
            className="rounded-[8px] border border-[#e4e7eb] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#15171c] hover:bg-[#f6f7f9] disabled:opacity-40"
          >
            Today
          </button>

          {/* Week stepper */}
          <div className="flex items-center rounded-[8px] border border-[#e4e7eb] bg-white">
            <button
              type="button"
              onClick={() => go(addDays(viewDate, -7))}
              className="px-2.5 py-1.5 text-[12px] font-bold text-[#15171c] hover:bg-[#f6f7f9]"
              aria-label="Previous week"
              title="Previous week (P)"
            >
              ‹
            </button>
            <span className="min-w-[86px] px-1 text-center text-[11px] font-bold text-[#5b626d]">
              {weekRangeLabel(dates)}
            </span>
            <button
              type="button"
              onClick={() => go(addDays(viewDate, 7))}
              className="px-2.5 py-1.5 text-[12px] font-bold text-[#15171c] hover:bg-[#f6f7f9]"
              aria-label="Next week"
              title="Next week (N)"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-[10px] border border-[#e4e7eb] bg-white">
          <Spinner label={loadingAccounts ? 'Loading accounts…' : 'Loading meetings…'} />
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-10 text-center text-[12.5px] font-bold text-[#959ca7]">
          No booked meetings yet. Run the Activate demo seed to populate the calendar.
        </div>
      ) : weekMeetingCount === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-10 text-center text-[12.5px] font-bold text-[#959ca7]">
          No meetings booked this week.
          <div className="mt-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#c2c7ce]">
            {weekRangeLabel(dates)} · use ‹ › to find a week with meetings
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[#e4e7eb]">
          <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-[#e4e7eb] bg-white">
            <div className="flex items-end justify-end px-2 pb-2 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
              GMT+02
            </div>

            {dates.map((d) => {
              const count = eventsFor(d).length;

              return (
                <div
                  key={d.toISOString()}
                  className="border-l border-[#e4e7eb] px-2 py-2 text-center"
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#5b626d]">
                    {dayLabel(d)}
                  </div>
                  <div className="mt-1 text-[9px] font-bold text-[#959ca7]">
                    {count ? `${count} meeting${count > 1 ? 's' : ''}` : 'free'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid max-h-[560px] grid-cols-[64px_repeat(7,minmax(0,1fr))] overflow-y-auto">
            <div className="relative bg-white">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  style={{ height: ROW_H }}
                  className="border-t border-[#e4e7eb] pr-2 text-right text-[9.5px] font-bold text-[#959ca7]"
                >
                  <span className="relative top-[-7px]">
                    {hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`}
                  </span>
                </div>
              ))}
            </div>

            {dates.map((d) => (
              <div
                key={d.toISOString()}
                className="relative border-l border-[#e4e7eb] bg-white"
              >
                {HOURS.map((hour) => (
                  <div key={hour} style={{ height: ROW_H }} className="border-t border-[#e4e7eb]" />
                ))}

                {eventsFor(d).map((meeting) => (
                  <CalendarEvent
                    key={meeting.id}
                    meeting={meeting}
                    onOpen={() => setOpenMeeting(meeting)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {loadingMeetings && meetings.length > 0 ? (
        <div className="mt-2 flex justify-center text-[11px] font-bold text-[#959ca7]">
          <Spinner inline size={14} label="Refreshing…" />
        </div>
      ) : null}

      {openMeeting ? (
        <MeetingPopup
          meeting={openMeeting}
          accountId={accountId}
          accounts={accounts}
          onClose={() => setOpenMeeting(null)}
          onSaved={() => {
            setOpenMeeting(null);
            onMeetingChanged();
          }}
        />
      ) : null}
    </GrowthCard>
  );
}

function CalendarEvent({
  meeting,
  onOpen,
}: {
  meeting: CalendarMeeting;
  onOpen: () => void;
}) {
  const [rawHour = DAY_START, minute = 0] = meeting.time.split(':').map(Number);
  const hour = Number.isFinite(rawHour) ? rawHour : DAY_START;
  const top = (hour - DAY_START) * ROW_H + (minute / 60) * ROW_H;
  // Color-code the event by the account whose calendar it lives on. Border (all sides
  // + a thicker left accent) takes the account color; the fill is the same hue, faint.
  const color = meeting.accountColor ?? '#15171c';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="gc-press absolute left-1.5 right-1.5 z-[1] cursor-pointer rounded-md border border-l-[3px] px-2 py-1.5 text-left transition-all duration-150 hover:z-[2] hover:shadow-[0_4px_12px_-6px_rgba(21,23,28,0.3)]"
      style={{
        top,
        minHeight: ROW_H - 12,
        borderColor: color,
        borderLeftColor: color,
        background: `${color}14`,
      }}
    >
      <div className="text-[9px] font-bold text-[#959ca7]">{meeting.time}</div>
      <div className="truncate text-[10.5px] font-bold text-[#15171c]">
        {meeting.company}
      </div>
      <div className="truncate text-[9.5px] text-[#959ca7]">
        {meeting.contact} · {meeting.title}
      </div>
    </button>
  );
}

// Convert an ISO datetime to the value a <input type="datetime-local"> expects
// (YYYY-MM-DDTHH:mm in the browser's local time).
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MeetingPopup({
  meeting,
  accountId,
  accounts,
  onClose,
  onSaved,
}: {
  meeting: CalendarMeeting;
  accountId: string;
  accounts: MeetingAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [joining, setJoining] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // The account this meeting actually lives on (in all-accounts mode the selected
  // accountId is 'all', so prefer the meeting's own account).
  const sourceAccountId = meeting.accountId ?? accountId;

  // Edit-state form, seeded from the meeting.
  const [title, setTitle] = useState(meeting.title);
  const [startLocal, setStartLocal] = useState(toLocalInput(meeting.startsAt));
  const [location, setLocation] = useState(meeting.location ?? '');
  const [description, setDescription] = useState(meeting.description ?? '');
  const [targetAccountId, setTargetAccountId] = useState(sourceAccountId);

  async function handleJoin() {
    setJoining(true);
    try {
      const res = await requestToJoinMeeting(sourceAccountId, meeting.id);
      const url = res.joinUrl ?? res.htmlLink;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // surface nothing destructive — the calendar link still works
    } finally {
      setJoining(false);
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error('Title is required.');
      return;
    }
    setSaving(true);
    try {
      const dur = meeting.durationMinutes ?? 30;
      const start = startLocal ? new Date(startLocal).toISOString() : undefined;
      const end =
        startLocal && start
          ? new Date(new Date(startLocal).getTime() + dur * 60_000).toISOString()
          : undefined;

      // 1) Move to another account first (copy + delete) if the account changed.
      let eventId = meeting.id;
      let onAccount = sourceAccountId;
      if (targetAccountId && targetAccountId !== sourceAccountId) {
        const moved = await moveMeeting(meeting.id, sourceAccountId, targetAccountId);
        eventId = moved.id;
        onAccount = targetAccountId;
      }

      // 2) Apply the field edits on whichever account now holds the event.
      await updateMeeting(onAccount, eventId, {
        title: title.trim(),
        location: location.trim() || null,
        description: description.trim() || null,
        ...(start ? { start, end } : {}),
      });

      toast.success(
        targetAccountId !== sourceAccountId
          ? 'Meeting moved and updated.'
          : 'Meeting updated.',
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the meeting.');
    } finally {
      setSaving(false);
    }
  }

  const when = meeting.startsAt
    ? new Date(meeting.startsAt).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : `${meeting.day} · ${meeting.time}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 duration-200 animate-in fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[460px] rounded-[12px] border border-[#e4e7eb] bg-white shadow-xl duration-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e4e7eb] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-[#15171c]">
              {editing ? 'Edit meeting' : meeting.title}
            </div>
            <div className="mt-1 text-[11px] text-[#959ca7]">{when}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] leading-none text-[#959ca7] hover:text-[#15171c]"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {editing ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <EditField label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-[#e4e7eb] px-2.5 py-1.5 text-[12.5px] text-[#15171c] outline-none focus:border-[#15171c]"
              />
            </EditField>
            <EditField label="Start">
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="w-full rounded-md border border-[#e4e7eb] px-2.5 py-1.5 text-[12.5px] text-[#15171c] outline-none focus:border-[#15171c]"
              />
            </EditField>
            <EditField label="Location">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-md border border-[#e4e7eb] px-2.5 py-1.5 text-[12.5px] text-[#15171c] outline-none focus:border-[#15171c]"
              />
            </EditField>
            <EditField label="Account">
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                className="w-full rounded-md border border-[#e4e7eb] bg-white px-2.5 py-1.5 text-[12.5px] text-[#15171c] outline-none focus:border-[#15171c]"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </EditField>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Notes
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-md border border-[#e4e7eb] px-2.5 py-1.5 text-[12.5px] leading-relaxed text-[#15171c] outline-none focus:border-[#15171c]"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            <DetailRow label="Company" value={meeting.company} />
            <DetailRow label="Contact" value={meeting.contact} />
            {meeting.accountEmail ? (
              <DetailRow label="On account" value={meeting.accountEmail} />
            ) : null}
            {meeting.durationMinutes ? (
              <DetailRow label="Duration" value={`${meeting.durationMinutes} min`} />
            ) : null}
            {meeting.location ? <DetailRow label="Location" value={meeting.location} /> : null}
            {meeting.organizer ? <DetailRow label="Organizer" value={meeting.organizer} /> : null}
            {meeting.attendees && meeting.attendees.length > 0 ? (
              <DetailRow
                label="Attendees"
                value={meeting.attendees
                  .map((a) => a.name ?? a.email ?? '')
                  .filter(Boolean)
                  .join(', ')}
              />
            ) : null}
            {meeting.description ? (
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                  Notes
                </div>
                <p className="max-h-[120px] overflow-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#5b626d]">
                  {meeting.description}
                </p>
              </div>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[#e4e7eb] px-5 py-4">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="gc-press rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c] hover:bg-[#f6f7f9] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="gc-press rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white hover:bg-[#2a2d34] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="gc-press rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c] hover:bg-[#f6f7f9]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="gc-press rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c] hover:bg-[#f6f7f9]"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={handleJoin}
                disabled={joining}
                className="gc-press rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white hover:bg-[#2a2d34] disabled:opacity-50"
              >
                {joining ? 'Opening…' : 'Request to join'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
        {label}
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-[#d6dade] pb-2 text-[12.5px]">
      <span className="text-[#959ca7]">{label}</span>
      <b className="text-right text-[#15171c]">{value}</b>
    </div>
  );
}
