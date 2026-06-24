import {
  resolveScheduling,
  type SchedulingCalendar,
  type Slot,
} from '../src/engage/meeting-loop';

// A fake calendar implementing only the methods resolveScheduling calls, so the
// resolution logic is tested in isolation (no Google / org wiring). Each test wires
// the desired isWindowFree / alternativesNear behaviour + the org's primary zone (the
// business-hours gate is evaluated in this zone).
function fakeCalendar(opts: {
  free?: boolean;
  alternatives?: Slot[];
  primary?: string;
}): SchedulingCalendar {
  return {
    async isWindowFree() {
      return { configured: true, free: opts.free ?? false, reason: null };
    },
    async alternativesNear() {
      return opts.alternatives ?? [];
    },
    async getOrgTimeZones() {
      return { primary: opts.primary ?? 'Europe/Berlin', secondary: null };
    },
  };
}

const ORG = 'org-1';
const OFFERED: Slot[] = [
  { start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T09:30:00.000Z' },
  { start: '2026-07-01T14:00:00.000Z', end: '2026-07-01T14:30:00.000Z' },
];

// Wed 12:00 in Europe/Berlin — inside the 09:00–17:00 business window.
const COUNTER_IN_HOURS = '2026-07-01T10:00:00.000Z';
// Thu 02:00 in Europe/Berlin — a free-but-night instant that must NOT auto-book.
const COUNTER_NIGHT = '2026-07-02T00:00:00.000Z';

describe('resolveScheduling', () => {
  it('(a) accepted offered index → ACCEPTED with that slot', async () => {
    const cal = fakeCalendar({ free: false });
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: 1, counter_time: null },
      OFFERED,
    );
    expect(res).toEqual({ status: 'ACCEPTED', acceptedSlot: OFFERED[1] });
  });

  it('(b) counter_time in business hours + free → ACCEPTED with the counter window', async () => {
    const cal = fakeCalendar({ free: true });
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: null, counter_time: COUNTER_IN_HOURS },
      OFFERED,
    );
    expect(res).toEqual({
      status: 'ACCEPTED',
      acceptedSlot: { start: COUNTER_IN_HOURS, end: '2026-07-01T10:30:00.000Z' },
    });
  });

  it('(c) counter_time in business hours but busy → COUNTER with alternatives', async () => {
    const alternatives: Slot[] = [
      { start: '2026-07-01T11:00:00.000Z', end: '2026-07-01T11:30:00.000Z' },
    ];
    const cal = fakeCalendar({ free: false, alternatives });
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: null, counter_time: COUNTER_IN_HOURS },
      OFFERED,
    );
    expect(res).toEqual({
      status: 'COUNTER',
      alternatives,
      counterTime: COUNTER_IN_HOURS,
    });
  });

  it('(d) counter_time OUTSIDE business hours (2am) — even if free → COUNTER, never auto-book', async () => {
    const alternatives: Slot[] = [
      { start: '2026-07-02T08:00:00.000Z', end: '2026-07-02T08:30:00.000Z' },
    ];
    const cal = fakeCalendar({ free: true, alternatives });
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: null, counter_time: COUNTER_NIGHT },
      OFFERED,
    );
    expect(res).toEqual({
      status: 'COUNTER',
      alternatives,
      counterTime: COUNTER_NIGHT,
    });
  });

  it('(e) unparseable counter_time → NONE (propose path offers concrete slots)', async () => {
    const cal = fakeCalendar({ free: true });
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: null, counter_time: 'sometime Friday' },
      OFFERED,
    );
    expect(res).toEqual({ status: 'NONE' });
  });

  it('(f) no scheduling signal → NONE', async () => {
    const cal = fakeCalendar({ free: true });
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: null, counter_time: null },
      OFFERED,
    );
    expect(res).toEqual({ status: 'NONE' });
  });
});
