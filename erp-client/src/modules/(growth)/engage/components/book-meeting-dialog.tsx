'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { bookMeeting } from '../services/engage.service';

// A small modal for booking a meeting from an INTERESTED reply (the Engage→Activate
// handoff). Pre-filled from the reply (company, contact email); the operator confirms
// the time. On save it creates a Google Calendar event (+ Meet link) on the campaign's
// mailbox — it then shows up in Activate's Meeting Booker.
type BookMeetingDialogProps = {
  open: boolean;
  onClose: () => void;
  company: string;
  clientEmail: string;
  contactName?: string;
  // The client's latest message text — parsed for a proposed day/time to pre-fill the slot.
  suggestedText?: string;
  // The campaign's mailbox google_accounts id — books on that calendar. null = org default.
  mailboxAccountId: string | null;
  // An exact, pre-agreed window (ISO start/end). When present it overrides the text
  // heuristic so the one-click "Book it" from an accepted slot is precise, and the
  // duration defaults to the slot's own length.
  presetSlot?: { start: string; end: string };
  // Fired with the created meeting's id after a successful book, so the caller can
  // close the meeting loop (link the meeting to the campaign reply).
  onBooked?: (meetingId: string) => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

// Format a Date for <input type="datetime-local"> (local time, no timezone).
function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Tomorrow (skipping the weekend) at 10:00 — the fallback when the reply has no date hint.
function defaultDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  d.setHours(10, 0, 0, 0);
  return d;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Roll a (month,day) forward to this year, or next year if it's already in the past.
function monthDay(month: number, day: number): Date | null {
  if (month < 0 || day < 1 || day > 31) return null;
  const now = new Date();
  let d = new Date(now.getFullYear(), month, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d.getTime() < today.getTime()) d = new Date(now.getFullYear() + 1, month, day);
  return d;
}

// The next occurrence of weekday `target` (this week, or next week if it's already
// passed). `forceNext` ("next Tuesday") pushes it to the following week.
function weekdayDate(target: number, forceNext: boolean): Date {
  const now = new Date();
  let delta = (target - now.getDay() + 7) % 7; // 0..6, the upcoming occurrence
  if (forceNext) delta += 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
  return d;
}

// Best-effort: read a proposed day/time out of the client's reply. Handles weekdays
// ("Tuesday", "next Mon"), explicit dates ("June 25", "25/06", "2026-06-25"), and a
// time of day ("3pm", "15:00", "afternoon"). Returns the parsed Date + whether anything
// matched (so the caller can fall back to the default slot).
function deriveSlot(text?: string): { date: Date; matched: boolean } {
  const base = defaultDate();
  if (!text) return { date: base, matched: false };
  const t = text.toLowerCase();

  // --- time of day ---
  let hour: number | null = null;
  let minute = 0;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/))) {
    hour = (Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0);
    minute = m[2] ? Number(m[2]) : 0;
  } else if ((m = t.match(/\b(\d{1,2}):(\d{2})\b/))) {
    hour = Number(m[1]);
    minute = Number(m[2]);
  } else if (/\bnoon\b/.test(t)) hour = 12;
  else if (/\bmorning\b/.test(t)) hour = 10;
  else if (/\bafternoon\b/.test(t)) hour = 14;
  else if (/\bevening\b/.test(t)) hour = 17;

  // --- date / weekday ---
  let day: Date | null = null;
  let d: RegExpMatchArray | null;
  if ((d = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
    day = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  } else if (
    (d = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/))
  ) {
    day = monthDay(MONTHS[d[1]!]!, Number(d[2]));
  } else if (
    (d = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/))
  ) {
    day = monthDay(MONTHS[d[2]!]!, Number(d[1]));
  } else if ((d = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/))) {
    // EU order: day/month. Year from the match or rolled forward.
    const dd = Number(d[1]);
    const mm = Number(d[2]) - 1;
    day = monthDay(mm, dd);
  } else {
    const wd = t.match(
      /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)\b/,
    );
    if (wd) day = weekdayDate(WEEKDAYS[wd[2]!]!, Boolean(wd[1]));
  }

  const matched = day !== null || hour !== null;
  const result = day ?? new Date(base);
  result.setHours(hour ?? base.getHours(), minute, 0, 0);
  return { date: matched ? result : base, matched };
}

const DURATIONS = [15, 30, 45, 60];

// Minutes between two ISO instants, clamped to the supported durations (default 30).
function slotDuration(slot: { start: string; end: string }): number {
  const mins = Math.round(
    (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60_000,
  );
  return DURATIONS.includes(mins) ? mins : 30;
}

export function BookMeetingDialog({
  open,
  onClose,
  company,
  clientEmail,
  contactName,
  suggestedText,
  mailboxAccountId,
  presetSlot,
  onBooked,
}: BookMeetingDialogProps) {
  // An exact pre-agreed window wins over the free-text heuristic.
  const initial = presetSlot
    ? { date: new Date(presetSlot.start), matched: true }
    : deriveSlot(suggestedText);
  const [name, setName] = useState(contactName ?? '');
  const [email, setEmail] = useState(clientEmail);
  const [slot, setSlot] = useState(fmtLocal(initial.date));
  const [fromReply, setFromReply] = useState(initial.matched);
  const [duration, setDuration] = useState(
    presetSlot ? slotDuration(presetSlot) : 30,
  );
  const [booking, setBooking] = useState(false);

  // Re-derive the proposed slot each time the dialog opens. A `presetSlot` is exact;
  // otherwise fall back to parsing the client's reply text.
  useEffect(() => {
    if (!open) return;
    if (presetSlot) {
      setSlot(fmtLocal(new Date(presetSlot.start)));
      setFromReply(true);
      setDuration(slotDuration(presetSlot));
    } else {
      const next = deriveSlot(suggestedText);
      setSlot(fmtLocal(next.date));
      setFromReply(next.matched);
      setDuration(30);
    }
    setName(contactName ?? '');
    setEmail(clientEmail);
  }, [open, suggestedText, contactName, clientEmail, presetSlot]);

  if (!open) return null;

  async function handleBook() {
    if (!email.trim() || !slot || booking) return;
    // datetime-local has no timezone; interpret it as local and send an ISO string.
    const startsAt = new Date(slot);
    if (Number.isNaN(startsAt.getTime())) {
      toast.error('Pick a valid date and time.');
      return;
    }
    setBooking(true);
    try {
      const meeting = await bookMeeting({
        company,
        contactName: name.trim() || undefined,
        clientEmail: email.trim(),
        startsAt: startsAt.toISOString(),
        durationMinutes: duration,
        accountId: mailboxAccountId ?? undefined,
      });
      toast.success(
        meeting.joinUrl
          ? `Meeting booked — invite + Meet link sent to ${email.trim()}. It’s now in Activate.`
          : `Meeting booked for ${company}. It’s now in Activate.`,
      );
      onBooked?.(meeting.id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not book the meeting.');
    } finally {
      setBooking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] rounded-[14px] border border-border bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-[15px] font-bold text-foreground">Book a meeting</div>
        <div className="mt-1 text-[12px] text-muted-foreground">
          Creates a calendar invite with a Google Meet link for{' '}
          <span className="font-bold text-foreground">{company}</span> and adds it to
          Activate.
        </div>

        <label className="mt-4 block text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Contact name
        </label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Optional"
          className="mt-1 w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground"
        />

        <label className="mt-3 block text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Client email
        </label>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          className="mt-1 w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground"
        />

        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <label className="block text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Date & time
            </label>
            <input
              value={slot}
              onChange={(event) => {
                setSlot(event.target.value);
                setFromReply(false);
              }}
              type="datetime-local"
              className="mt-1 w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-foreground"
            />
            {fromReply ? (
              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Suggested from the client&apos;s reply
              </div>
            ) : null}
          </div>
          <div className="w-[110px]">
            <label className="block text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Duration
            </label>
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="mt-1 w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-foreground"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={booking}
            className="rounded-md border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleBook}
            disabled={booking || !email.trim() || !slot}
            className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-50"
          >
            {booking ? 'Booking…' : 'Book meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}
