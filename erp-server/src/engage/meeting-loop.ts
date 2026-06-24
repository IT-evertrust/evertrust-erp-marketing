// ===========================================================================
// Engage · meeting-loop scheduling resolution (propose → accept/counter → book).
// ---------------------------------------------------------------------------
// Pure-ish resolution of the reply_glock `scheduling` verdict against the org's
// calendar. Extracted as a free function so it can be unit-tested with a fake
// calendar (only the two methods it calls are required), independent of the full
// EngageRepliesService / Gmail / agent wiring.
// ===========================================================================

export interface Slot {
  start: string;
  end: string;
}

// The slice of GoogleCalendarReadService the resolution needs — kept minimal so a
// test can pass a fake object implementing just these two methods.
export interface SchedulingCalendar {
  isWindowFree(
    orgId: string,
    start: string,
    end: string,
  ): Promise<{ configured: boolean; free: boolean; reason: string | null }>;
  alternativesNear(orgId: string, around: string): Promise<Slot[]>;
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

// Resolve a reply_glock scheduling verdict into a meeting outcome:
//   - accepted one of the slots we offered → ACCEPTED with that slot.
//   - counter-proposed a time that is free on our calendar → ACCEPTED with a
//     30-minute window starting at the counter time.
//   - counter-proposed a busy time → COUNTER with the nearest free alternatives.
//   - neither → NONE (leave meeting fields untouched).
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
    const end = new Date(
      new Date(verdict.counter_time).getTime() + COUNTER_WINDOW_MS,
    ).toISOString();
    const { free } = await calendar.isWindowFree(orgId, verdict.counter_time, end);
    if (free) {
      return { status: 'ACCEPTED', acceptedSlot: { start: verdict.counter_time, end } };
    }
    const alternatives = await calendar.alternativesNear(orgId, verdict.counter_time);
    return { status: 'COUNTER', alternatives, counterTime: verdict.counter_time };
  }
  return { status: 'NONE' };
}
