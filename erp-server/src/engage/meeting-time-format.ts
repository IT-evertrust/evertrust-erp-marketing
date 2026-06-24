// Deterministic, dependency-free rendering of meeting slots as NATURAL PROSE for client
// emails. The slot is an absolute instant (ISO-8601 UTC); we render it in the org's
// PRIMARY zone (e.g. Europe/Berlin → GMT+2) with a SECONDARY cross-reference (e.g.
// Asia/Bangkok → GMT+7). This is the single source of truth for the time a client sees —
// it must equal the calendar invite, so it is rendered from the SAME slot the booking
// uses and the drafter LLM is barred from writing times of its own. The phrasing varies
// by `kind` (proposing options / confirming a booking / offering alternatives).

export type Slot = { start: string; end: string };
export type MeetingKind = 'propose' | 'accept' | 'counter';

interface LocalParts {
  weekday: string;
  day: string;
  month: string;
  hour: string;
  minute: string;
  offset: string; // 'GMT+2'
}

function localParts(at: Date, timeZone: string): LocalParts {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => f.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: get('weekday'),
    day: get('day'),
    month: get('month'),
    hour: get('hour'),
    minute: get('minute'),
    offset: get('timeZoneName'),
  };
}

// One slot as a natural phrase, e.g. "Thursday, 25 June at 09:00 (GMT+2) · 14:00 (GMT+7)".
function formatSlot(slot: Slot, primaryTz: string, secondaryTz: string | null): string {
  const start = new Date(slot.start);
  const p = localParts(start, primaryTz);
  let phrase = `${p.weekday}, ${p.day} ${p.month} at ${p.hour}:${p.minute} (${p.offset})`;
  if (secondaryTz) {
    const s = localParts(start, secondaryTz);
    phrase += ` · ${s.hour}:${s.minute} (${s.offset})`;
  }
  return phrase;
}

// The grounded slot(s) as bare dual-zone bullet lines — no wrapper sentences. The
// surrounding prose (a lead-in + the "which works for you?" ask) is the drafter LLM's
// natural wording; the system only owns the authoritative TIMES, injected as these
// bullets so they read as part of the email, not a robotic appended block.
export function renderSlotBullets(
  slots: Slot[],
  primaryTz: string,
  secondaryTz: string | null,
): string {
  return slots.map((s) => `• ${formatSlot(s, primaryTz, secondaryTz)}`).join('\n');
}

// The booking confirmation for an agreed slot — the grounded time only, no "looking
// forward to it!" tail (the drafter writes its own closing). e.g. "You're all set for
// Thursday, 25 June at 09:00 (GMT+2) · 14:00 (GMT+7) — I'll send a calendar invite to lock
// it in." Injected right after the drafter's "I've added our call to my calendar." sentence.
export function renderAcceptConfirmation(
  slot: Slot,
  primaryTz: string,
  secondaryTz: string | null,
): string {
  return `You're all set for ${formatSlot(slot, primaryTz, secondaryTz)} — I'll send a calendar invite to lock it in.`;
}

// Render the meeting time(s) as a natural sentence in Hanna's voice. `kind`:
//   propose → offer the slot(s) and invite a pick or a counter-suggestion
//   accept  → confirm the agreed slot (a calendar invite follows)
//   counter → the requested time was taken; offer alternatives
export function renderMeetingProse(
  slots: Slot[],
  primaryTz: string,
  secondaryTz: string | null,
  kind: MeetingKind = 'propose',
): string {
  if (slots.length === 0) return '';
  const lines = slots.map((s) => formatSlot(s, primaryTz, secondaryTz));
  const one = lines[0]!;
  const bullets = lines.map((l) => `• ${l}`).join('\n');

  if (kind === 'accept') {
    return `You're all set for ${one} — I'll send a calendar invite to lock it in. Looking forward to it!`;
  }
  if (kind === 'counter') {
    return slots.length === 1
      ? `That time was just taken on our side — would ${one} work instead? Happy to find another if not.`
      : `That time was just taken on our side — would either of these work instead?\n${bullets}\nHappy to find another time if neither fits.`;
  }
  // propose
  return slots.length === 1
    ? `Would ${one} work for you? If another time suits your team better, just let me know and I'll find one that fits.`
    : `Would either of these times work for you?\n${bullets}\nLet me know which suits you best — or suggest another and I'll make it work.`;
}
