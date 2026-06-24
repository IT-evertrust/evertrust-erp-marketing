// Deterministic, dependency-free rendering of meeting slots for client emails. The
// slot is an absolute instant (ISO-8601 UTC); we render it in the org's PRIMARY zone
// (e.g. Europe/Berlin → CET/CEST, GMT+2) with a SECONDARY cross-reference (e.g.
// Asia/Bangkok → GMT+7). This is the single source of truth for the time a client sees;
// it must equal the calendar invite, so it is rendered from the SAME slot the booking
// uses — the drafter LLM is barred from writing times of its own.

export type Slot = { start: string; end: string };

interface LocalParts {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  offset: string; // e.g. 'GMT+2'
}

function localParts(at: Date, timeZone: string): LocalParts {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    f.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: get('weekday'),
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour'),
    minute: get('minute'),
    offset: get('timeZoneName'), // 'GMT+2', 'GMT+7', …
  };
}

function hm(at: Date, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${p.hour}:${p.minute}`;
}

// One human line for a slot, e.g.:
// "Thursday, 25 June 2026, 09:30–10:00 (GMT+2) · 14:30–15:00 (GMT+7)"
function formatSlot(
  slot: Slot,
  primaryTz: string,
  secondaryTz: string | null,
): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const p = localParts(start, primaryTz);
  let line =
    `${p.weekday}, ${p.day} ${p.month} ${p.year}, ` +
    `${hm(start, primaryTz)}–${hm(end, primaryTz)} (${p.offset})`;
  if (secondaryTz) {
    const s = localParts(start, secondaryTz);
    line += ` · ${hm(start, secondaryTz)}–${hm(end, secondaryTz)} (${s.offset})`;
  }
  return line;
}

export function formatMeetingTimeBlock(
  slots: Slot[],
  primaryTz: string,
  secondaryTz: string | null,
): string {
  return slots.map((s) => formatSlot(s, primaryTz, secondaryTz)).join('\n');
}
