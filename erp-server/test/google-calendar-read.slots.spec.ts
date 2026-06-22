import { computeFreeSlots } from '../src/google/google-calendar-read.service';

// computeFreeSlots is the PURE slot generator behind GET /meetings/calendar/free-slots.
// Given busy intervals (built from CLIENT meetings only) + a reference `now`, it returns
// thirty-minute openings inside 09:00–17:00 business hours over the next 7 days, on the
// allowed business days (default Mon–Fri). It applies a PER-DAY cap (max 4 openings per
// day) so later days still surface slots instead of the earliest day or two exhausting a
// single global budget, bounded by an overall ceiling. These tests pin the contract:
// business-hour windowing, configurable business days, future-only slots, busy-overlap
// exclusion, the per-day cap distributing across days, and DST correctness — all with no
// network and no Google dependency.

// The per-day cap mirrored from the service so assertions track the source of truth.
const MAX_FREE_SLOTS_PER_DAY = 4;

// A Europe/Berlin wall-clock instant as a real UTC Date. We avoid hardcoding the
// offset by formatting a UTC guess back through the zone and correcting once — the
// same technique the service uses, exercised here against known dates.
function berlin(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(
    fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
  );
  let hour = Number(p.hour);
  if (hour === 24) hour = 0;
  const seen = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hour,
    Number(p.minute),
  );
  return new Date(guess - (seen - guess));
}

// The first slot of a non-empty result (asserts presence so strict index access is
// satisfied and an empty result fails loudly rather than reading undefined).
function firstSlot(slots: { start: string; end: string }[]): {
  start: string;
  end: string;
} {
  const s = slots[0];
  if (!s) throw new Error('expected at least one slot');
  return s;
}

// Hour/minute/weekday of an ISO instant rendered in Europe/Berlin.
function berlinHM(iso: string): { hour: number; minute: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const p = Object.fromEntries(
    fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  let hour = Number(p.hour);
  if (hour === 24) hour = 0;
  return { hour, minute: Number(p.minute), weekday: p.weekday as string };
}

// Slot count per calendar day (YYYY-MM-DD) in a given zone — used to assert the
// per-day cap and that slots are distributed across multiple days.
function slotsPerDay(
  slots: { start: string; end: string }[],
  tz = 'Europe/Berlin',
): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const hist: Record<string, number> = {};
  for (const s of slots) {
    const key = fmt.format(new Date(s.start));
    hist[key] = (hist[key] ?? 0) + 1;
  }
  return hist;
}

describe('computeFreeSlots', () => {
  it('returns openings inside weekday 09:00–17:00 Europe/Berlin, capped per day', () => {
    // Wednesday 2026-06-17, 08:00 Berlin — before business hours, no busy events.
    const now = berlin(2026, 6, 17, 8, 0);
    const slots = computeFreeSlots([], now);

    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const { hour, minute, weekday } = berlinHM(s.start);
      // 09:00 inclusive .. 16:30 (last 30-min slot before 17:00).
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
      expect(minute % 30).toBe(0);
      expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(weekday);
      // Each slot is exactly 30 minutes.
      expect(new Date(s.end).getTime() - new Date(s.start).getTime()).toBe(
        30 * 60_000,
      );
    }
    // No single day exceeds the per-day cap.
    for (const count of Object.values(slotsPerDay(slots))) {
      expect(count).toBeLessThanOrEqual(MAX_FREE_SLOTS_PER_DAY);
    }
    // First proposed slot is the first business-hours slot of the day, 09:00.
    expect(berlinHM(firstSlot(slots).start).hour).toBe(9);
    expect(berlinHM(firstSlot(slots).start).minute).toBe(0);
  });

  it('distributes slots across multiple business days (per-day cap, not a global cap)', () => {
    // Regression: a global cap of 6 returned only Mon+Tue and never reached the rest of
    // the week. The per-day cap must surface slots on EVERY in-range business day.
    const now = berlin(2026, 6, 17, 8, 0); // Wednesday
    const slots = computeFreeSlots([], now);
    const perDay = slotsPerDay(slots);

    // More than two distinct business days get openings (the old bug returned ≤2).
    expect(Object.keys(perDay).length).toBeGreaterThan(2);
    // Every day that appears respects the per-day cap and contributes at least one slot.
    for (const count of Object.values(perDay)) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(MAX_FREE_SLOTS_PER_DAY);
    }
    // The first three business days (Wed/Thu/Fri) each fill to the per-day cap.
    expect(perDay['2026-06-17']).toBe(MAX_FREE_SLOTS_PER_DAY);
    expect(perDay['2026-06-18']).toBe(MAX_FREE_SLOTS_PER_DAY);
    expect(perDay['2026-06-19']).toBe(MAX_FREE_SLOTS_PER_DAY);
  });

  it('only proposes slots in the future relative to now', () => {
    // Wednesday 2026-06-17, 10:10 Berlin — mid-morning.
    const now = berlin(2026, 6, 17, 10, 10);
    const slots = computeFreeSlots([], now);

    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(new Date(s.start).getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
    // Next aligned slot after 10:10 is 10:30.
    expect(berlinHM(firstSlot(slots).start).hour).toBe(10);
    expect(berlinHM(firstSlot(slots).start).minute).toBe(30);
  });

  it('excludes slots that overlap a busy interval', () => {
    const now = berlin(2026, 6, 17, 8, 0);
    // Busy 09:00–11:00 Berlin blocks the 09:00, 09:30, 10:00, 10:30 slots.
    const window = {
      start: berlin(2026, 6, 17, 9, 0).getTime(),
      end: berlin(2026, 6, 17, 11, 0).getTime(),
    };
    const slots = computeFreeSlots([window], now);

    expect(slots.length).toBeGreaterThan(0);
    // First free slot is now 11:00 (busy ended exactly at 11:00).
    expect(berlinHM(firstSlot(slots).start).hour).toBe(11);
    expect(berlinHM(firstSlot(slots).start).minute).toBe(0);
    // No returned slot starts within the busy window.
    for (const s of slots) {
      const ms = new Date(s.start).getTime();
      const overlaps = ms < window.end && new Date(s.end).getTime() > window.start;
      expect(overlaps).toBe(false);
    }
  });

  it('only CLIENT meetings block — the caller passes client busy intervals only', () => {
    // The service builds `busy` from events classified 'client' ONLY; team/personal/
    // reminder/OOO never reach this function. So an empty `busy` (a day full of
    // internal/personal events) leaves the whole business day open.
    const now = berlin(2026, 6, 17, 8, 0);
    const noClientBusy = computeFreeSlots([], now);

    // A single client meeting 09:00–10:00 removes exactly the 09:00 + 09:30 openings.
    const clientBusy = computeFreeSlots(
      [
        {
          start: berlin(2026, 6, 17, 9, 0).getTime(),
          end: berlin(2026, 6, 17, 10, 0).getTime(),
        },
      ],
      now,
    );

    // With no client busy, Wednesday's first opening is 09:00.
    const noClientWed = noClientBusy.filter(
      (s) => berlinHM(s.start).weekday === 'Wed',
    );
    expect(berlinHM(firstSlot(noClientWed).start).hour).toBe(9);

    // With the one client meeting, Wednesday's first opening rolls to 10:00.
    const clientWed = clientBusy.filter((s) => berlinHM(s.start).weekday === 'Wed');
    expect(berlinHM(firstSlot(clientWed).start).hour).toBe(10);
    expect(berlinHM(firstSlot(clientWed).start).minute).toBe(0);
  });

  it('skips weekends by default — a Friday afternoon rolls into Monday', () => {
    // Friday 2026-06-19, 16:40 Berlin: only 16:... is gone; next is Monday 09:00.
    const now = berlin(2026, 6, 19, 16, 40);
    const slots = computeFreeSlots([], now);

    expect(slots.length).toBeGreaterThan(0);
    // No Sat/Sun openings under the default Mon–Fri business days.
    for (const s of slots) {
      expect(['Sat', 'Sun']).not.toContain(berlinHM(s.start).weekday);
    }
    // The very next slot is Monday 2026-06-22 at 09:00 Berlin (Sat/Sun skipped).
    expect(berlinHM(firstSlot(slots).start).weekday).toBe('Mon');
    expect(berlinHM(firstSlot(slots).start).hour).toBe(9);
    expect(berlinHM(firstSlot(slots).start).minute).toBe(0);
  });

  it('honors a configurable businessDays set (include Saturday)', () => {
    // Friday 2026-06-19, 16:40 Berlin with Mon–Sat allowed: Saturday 2026-06-20 now
    // surfaces openings before Monday rolls in.
    const now = berlin(2026, 6, 19, 16, 40);
    const slots = computeFreeSlots([], now, 'Europe/Berlin', 30, [1, 2, 3, 4, 5, 6]);

    expect(slots.length).toBeGreaterThan(0);
    const perDay = slotsPerDay(slots);
    // Saturday is bookable now.
    expect(perDay['2026-06-20']).toBe(MAX_FREE_SLOTS_PER_DAY);
    // Sunday is still excluded (not in the set), so no Sunday openings.
    for (const s of slots) {
      expect(berlinHM(s.start).weekday).not.toBe('Sun');
    }
    // The first opening is now Saturday 09:00 (the next business day after Fri close).
    expect(berlinHM(firstSlot(slots).start).weekday).toBe('Sat');
    expect(berlinHM(firstSlot(slots).start).hour).toBe(9);
  });

  it('falls back to Mon–Fri for an empty businessDays set', () => {
    const now = berlin(2026, 6, 19, 16, 40); // Friday
    const slots = computeFreeSlots([], now, 'Europe/Berlin', 30, []);

    expect(slots.length).toBeGreaterThan(0);
    // Empty set is treated as the default Mon–Fri: no weekend openings, next is Monday.
    for (const s of slots) {
      expect(['Sat', 'Sun']).not.toContain(berlinHM(s.start).weekday);
    }
    expect(berlinHM(firstSlot(slots).start).weekday).toBe('Mon');
  });

  it('renders slots at the correct Berlin offset under summer DST (CEST, UTC+2)', () => {
    // June is CEST (UTC+2): 09:00 Berlin == 07:00 UTC.
    const now = berlin(2026, 6, 17, 8, 0);
    const slots = computeFreeSlots([], now);
    const first = new Date(firstSlot(slots).start);
    expect(first.getUTCHours()).toBe(7); // 09:00 CEST -> 07:00 UTC
    expect(first.getUTCMinutes()).toBe(0);
  });

  it('renders slots at the correct Berlin offset under winter (CET, UTC+1)', () => {
    // January is CET (UTC+1): 09:00 Berlin == 08:00 UTC. 2026-01-07 is a Wednesday.
    const now = berlin(2026, 1, 7, 8, 0);
    const slots = computeFreeSlots([], now);
    const first = new Date(firstSlot(slots).start);
    expect(first.getUTCHours()).toBe(8); // 09:00 CET -> 08:00 UTC
    expect(first.getUTCMinutes()).toBe(0);
  });

  it('honours a non-Berlin org timezone (Asia/Bangkok, UTC+7, no DST)', () => {
    // The multi-tenant path: a third `tz` arg drives business hours in the org's zone.
    // A Bangkok wall-clock instant as a real UTC Date (same correction trick as berlin()).
    const inZone = (
      y: number,
      mo: number,
      d: number,
      h: number,
      mi: number,
      tz: string,
    ): Date => {
      const guess = Date.UTC(y, mo - 1, d, h, mi);
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const p = Object.fromEntries(
        fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
      );
      let hh = Number(p.hour);
      if (hh === 24) hh = 0;
      const seen = Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        hh,
        Number(p.minute),
      );
      return new Date(guess - (seen - guess));
    };

    const zoneHM = (iso: string, tz: string) => {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
      });
      const p = Object.fromEntries(
        fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
      );
      let hour = Number(p.hour);
      if (hour === 24) hour = 0;
      return { hour, minute: Number(p.minute), weekday: p.weekday as string };
    };

    const TZ = 'Asia/Bangkok';
    // Wednesday 2026-06-17, 08:00 Bangkok — before business hours, no busy events.
    const now = inZone(2026, 6, 17, 8, 0, TZ);
    const slots = computeFreeSlots([], now, TZ);

    expect(slots.length).toBeGreaterThan(0);
    // First slot is the day's first business-hours opening: 09:00 Bangkok == 02:00 UTC.
    const first = firstSlot(slots);
    expect(zoneHM(first.start, TZ).hour).toBe(9);
    expect(zoneHM(first.start, TZ).minute).toBe(0);
    expect(new Date(first.start).getUTCHours()).toBe(2); // UTC+7, no DST
    // Every slot sits inside weekday 09:00–17:00 Bangkok.
    for (const s of slots) {
      const { hour, weekday } = zoneHM(s.start, TZ);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
      expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(weekday);
    }
  });

  it('honors durationMinutes for slot LENGTH while keeping 30-min start grid', () => {
    // Wednesday 2026-06-17, 08:00 Berlin — before business hours, no busy events.
    const now = berlin(2026, 6, 17, 8, 0);
    const slots = computeFreeSlots([], now, undefined, 60);

    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      // Each slot is exactly 60 minutes long.
      expect(new Date(s.end).getTime() - new Date(s.start).getTime()).toBe(60 * 60_000);
      // Starts stay on the 30-minute grid.
      expect(berlinHM(s.start).minute % 30).toBe(0);
    }
    // First 60-min slot still opens at 09:00.
    expect(berlinHM(firstSlot(slots).start).hour).toBe(9);
    expect(berlinHM(firstSlot(slots).start).minute).toBe(0);
  });

  it('never proposes a slot that runs past 17:00 business close', () => {
    // Friday 2026-06-19, 16:00 Berlin: a 60-min slot would have to start <=16:00 to
    // finish by 17:00, so 16:30 is excluded and the next opening rolls to Monday.
    const now = berlin(2026, 6, 19, 16, 5);
    const slots = computeFreeSlots([], now, undefined, 60);

    for (const s of slots) {
      const end = berlinHM(s.end);
      // End hour is at most 17:00 (17:00 exact is allowed, never beyond).
      expect(end.hour < 17 || (end.hour === 17 && end.minute === 0)).toBe(true);
    }
    // The next 60-min opening is Monday 09:00 (Friday 16:30 can't fit a 60-min slot).
    expect(berlinHM(firstSlot(slots).start).weekday).toBe('Mon');
    expect(berlinHM(firstSlot(slots).start).hour).toBe(9);
  });

  it('falls back to 30-minute slots for a non-positive or NaN duration', () => {
    const now = berlin(2026, 6, 17, 8, 0);
    for (const bad of [0, -15, Number.NaN]) {
      const slots = computeFreeSlots([], now, undefined, bad);
      expect(slots.length).toBeGreaterThan(0);
      expect(new Date(firstSlot(slots).end).getTime() - new Date(firstSlot(slots).start).getTime()).toBe(
        30 * 60_000,
      );
    }
  });
});
