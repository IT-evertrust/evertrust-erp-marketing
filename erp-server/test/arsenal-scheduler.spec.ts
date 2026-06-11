import { msUntilNextDailyTime } from '../src/arsenal/arsenal.scheduler';

// WHY: the daily Bazooka send hinges on this pure clock math. Firing at the wrong
// time (or treating bad input as valid) means a missed or mistimed outbound batch.
// `now` is injected so the bands are pinned against a fixed local clock.
const NOW = new Date('2026-06-01T10:00:00'); // parsed as server-local time

describe('msUntilNextDailyTime', () => {
  it('returns ms until a time still ahead TODAY', () => {
    expect(msUntilNextDailyTime('10:30', NOW)).toBe(30 * 60 * 1000);
  });

  it('rolls over to TOMORROW once the time has passed', () => {
    // 09:00 is 1h before NOW (10:00), so the next occurrence is tomorrow 09:00 —
    // exactly 23h away.
    expect(msUntilNextDailyTime('09:00', NOW)).toBe(23 * 60 * 60 * 1000);
  });

  it('treats the exact current minute as tomorrow (never fires immediately in a loop)', () => {
    // 10:00 == now → must roll to tomorrow, not return 0.
    expect(msUntilNextDailyTime('10:00', NOW)).toBe(24 * 60 * 60 * 1000);
  });

  it('returns null on an invalid format (so the schedule disables loudly)', () => {
    expect(msUntilNextDailyTime('8am', NOW)).toBeNull();
    expect(msUntilNextDailyTime('25:00', NOW)).toBeNull();
    expect(msUntilNextDailyTime('10:60', NOW)).toBeNull();
    expect(msUntilNextDailyTime('', NOW)).toBeNull();
  });
});

describe('msUntilNextDailyTime — with an IANA timezone', () => {
  // WHY: the daily send must fire at the chosen wall-clock time IN THE CHOSEN ZONE,
  // not the opaque server clock. `now` is pinned to explicit UTC instants so these
  // bands hold regardless of the machine's local timezone. The summer/winter pair
  // proves the math is DST-aware (same 08:00 wall time → different UTC deltas).

  it('reads HH:MM in the zone (Berlin summer, CEST = UTC+2)', () => {
    // 2026-07-01T00:00Z is 02:00 in Berlin; 08:00 Berlin = 06:00Z → 6h ahead.
    const now = new Date('2026-07-01T00:00:00Z');
    expect(msUntilNextDailyTime('08:00', now, 'Europe/Berlin')).toBe(
      6 * 60 * 60 * 1000,
    );
  });

  it('reads HH:MM in the zone (Berlin winter, CET = UTC+1)', () => {
    // 2026-01-01T00:00Z is 01:00 in Berlin; 08:00 Berlin = 07:00Z → 7h ahead.
    const now = new Date('2026-01-01T00:00:00Z');
    expect(msUntilNextDailyTime('08:00', now, 'Europe/Berlin')).toBe(
      7 * 60 * 60 * 1000,
    );
  });

  it("rolls to tomorrow in the zone once today's time has passed", () => {
    // 2026-07-01T07:00Z is 09:00 in Berlin (past 08:00); next is tomorrow
    // 08:00 Berlin = 2026-07-02T06:00Z → 23h ahead.
    const now = new Date('2026-07-01T07:00:00Z');
    expect(msUntilNextDailyTime('08:00', now, 'Europe/Berlin')).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it('treats UTC as a passthrough zone', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    expect(msUntilNextDailyTime('08:00', now, 'UTC')).toBe(8 * 60 * 60 * 1000);
  });

  it('returns null for an unknown zone (schedule disables loudly)', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    expect(msUntilNextDailyTime('08:00', now, 'Mars/Phobos')).toBeNull();
  });

  it('still rejects an invalid time even with a valid zone', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    expect(msUntilNextDailyTime('25:00', now, 'Europe/Berlin')).toBeNull();
  });
});
