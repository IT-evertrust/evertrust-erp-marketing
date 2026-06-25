// ===========================================================================
// Engage · meeting-loop scheduling resolution (propose → accept/counter → book).
// ---------------------------------------------------------------------------
// Pure-ish resolution of the reply_glock `scheduling` verdict against the org's
// calendar. Extracted as a free function so it can be unit-tested with a fake
// calendar (only the methods it calls are required), independent of the full
// EngageRepliesService / Gmail / agent wiring.
// ===========================================================================

import { isWithinBusinessHours } from '../google/google-calendar-read.service';

export interface Slot {
  start: string;
  end: string;
}

// The slice of GoogleCalendarReadService the resolution needs — kept minimal so a
// test can pass a fake object implementing just these methods.
export interface SchedulingCalendar {
  isWindowFree(
    orgId: string,
    start: string,
    end: string,
  ): Promise<{ configured: boolean; free: boolean; reason: string | null }>;
  alternativesNear(orgId: string, around: string): Promise<Slot[]>;
  getOrgTimeZones(
    orgId: string,
  ): Promise<{ primary: string; secondary: string | null }>;
}

// reply_glock's scheduling verdict: which offered slot (if any) the lead accepted,
// and/or a counter-proposed time they asked for instead.
export interface SchedulingVerdict {
  accepted_index: number | null;
  counter_time: string | null;
}

export type MeetingResolution =
  | { status: 'ACCEPTED'; acceptedSlot: Slot }
  | { status: 'COUNTER'; alternatives: Slot[]; counterTime: string }
  | { status: 'NONE' };

// Default meeting length when we materialise a window from a single counter instant.
const COUNTER_WINDOW_MS = 30 * 60_000;

// When the lead names a concrete time that lands inside a slot we ALREADY offered, they
// are confirming that slot — return it. The lead can phrase an acceptance as a restated
// time ("Thursday 13:00 works") rather than picking the option by number, in which case
// the model reports it as a `counter_time` equal to the offered slot, not an
// `accepted_index`. We offered the slot because it was bookable and the lead just agreed
// to it, so this must resolve to ACCEPTED without a second free/business-hours check — a
// re-check can wrongly disagree (a tentative hold placed on that very slot, a zone edge)
// and bounce a genuine acceptance back to COUNTER, which is exactly the "keeps re-proposing
// the same times" failure. `at` matches when it falls within the offered [start, end).
function matchOfferedSlot(proposedSlots: Slot[], at: Date): Slot | null {
  const t = at.getTime();
  if (Number.isNaN(t)) return null;
  for (const slot of proposedSlots) {
    const start = new Date(slot.start).getTime();
    const end = new Date(slot.end).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && t >= start && t < end) {
      return slot;
    }
  }
  return null;
}

// Resolve a reply_glock scheduling verdict into a meeting outcome:
//   - accepted one of the slots we offered → ACCEPTED with that slot.
//   - counter-proposed a time inside business hours that is free → ACCEPTED with a
//     30-minute window starting at the counter time.
//   - counter-proposed a busy or out-of-hours time → COUNTER with the nearest free
//     business-hours alternatives.
//   - unparseable counter time, or no scheduling signal → NONE (the propose path can
//     then offer concrete slots).
export async function resolveScheduling(
  calendar: SchedulingCalendar,
  orgId: string,
  verdict: SchedulingVerdict,
  proposedSlots: Slot[],
): Promise<MeetingResolution> {
  if (verdict.accepted_index != null && proposedSlots[verdict.accepted_index]) {
    return { status: 'ACCEPTED', acceptedSlot: proposedSlots[verdict.accepted_index]! };
  }
  if (verdict.counter_time) {
    const at = new Date(verdict.counter_time);
    // Unparseable/garbage time → we can't book it; treat as no usable time so the
    // caller's propose path offers concrete slots instead of materialising junk.
    if (Number.isNaN(at.getTime())) return { status: 'NONE' };

    // The lead confirmed a time we already offered (restated it instead of picking the
    // number) → accept that exact offered slot, no second free/hours check.
    const offered = matchOfferedSlot(proposedSlots, at);
    if (offered) return { status: 'ACCEPTED', acceptedSlot: offered };

    const { primary } = await calendar.getOrgTimeZones(orgId);
    const end = new Date(at.getTime() + COUNTER_WINDOW_MS).toISOString();

    // Auto-confirm ONLY when the requested time is BOTH inside business hours (the
    // window we'd actually book in — same definition computeFreeSlots offers from) AND
    // free. A free-but-2am instant must not silently auto-book.
    if (isWithinBusinessHours(at, primary)) {
      const { free } = await calendar.isWindowFree(orgId, verdict.counter_time, end);
      if (free) {
        return { status: 'ACCEPTED', acceptedSlot: { start: verdict.counter_time, end } };
      }
    }
    const alternatives = await calendar.alternativesNear(orgId, verdict.counter_time);
    return { status: 'COUNTER', alternatives, counterTime: verdict.counter_time };
  }
  return { status: 'NONE' };
}
