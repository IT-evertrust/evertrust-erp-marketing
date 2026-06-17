import { computeFreeSlots } from '../src/google/google-calendar-read.service';

// computeFreeSlots is the PURE slot generator behind GET /meetings/calendar/free-slots.
// Given busy intervals + a reference `now`, it returns up to 6 thirty-minute openings
// inside weekday 09:00–17:00 Europe/Berlin business hours over the next 7 days. These
// tests pin the contract: business-hour windowing, weekend exclusion, future-only
// slots, busy-overlap exclusion, the 6-slot cap, and DST correctness — all with no
// network and no Google dependency.

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

// Hour/minute of an ISO instant rendered in Europe/Berlin.
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

describe('computeFreeSlots', () => {
  it('returns up to 6 slots, all inside weekday 09:00–17:00 Europe/Berlin', () => {
    // Wednesday 2026-06-17, 08:00 Berlin — before business hours, no busy events.
    const now = berlin(2026, 6, 17, 8, 0);
    const slots = computeFreeSlots([], now);

    expect(slots.length).toBe(6);
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
    // First proposed slot is the first business-hours slot of the day, 09:00.
    expect(berlinHM(firstSlot(slots).start).hour).toBe(9);
    expect(berlinHM(firstSlot(slots).start).minute).toBe(0);
  });

  it('only proposes slots in the future relative to now', () => {
    // Wednesday 2026-06-17, 10:10 Berlin — mid-morning.
    const now = berlin(2026, 6, 17, 10, 10);
    const slots = computeFreeSlots([], now);

    expect(slots.length).toBe(6);
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

    expect(slots.length).toBe(6);
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

  it('skips weekends — a Friday afternoon rolls into Monday', () => {
    // Friday 2026-06-19, 16:40 Berlin: only 16:... is gone; next is Monday 09:00.
    const now = berlin(2026, 6, 19, 16, 40);
    const slots = computeFreeSlots([], now);

    expect(slots.length).toBeGreaterThan(0);
    // The very next slot is Monday 2026-06-22 at 09:00 Berlin (Sat/Sun skipped).
    expect(berlinHM(firstSlot(slots).start).weekday).toBe('Mon');
    expect(berlinHM(firstSlot(slots).start).hour).toBe(9);
    expect(berlinHM(firstSlot(slots).start).minute).toBe(0);
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
});
