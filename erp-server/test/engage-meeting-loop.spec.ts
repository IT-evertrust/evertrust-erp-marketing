import {
  resolveScheduling,
  type SchedulingCalendar,
  type Slot,
} from '../src/engage/meeting-loop';

// A fake calendar implementing only the two methods resolveScheduling calls, so the
// resolution logic is tested in isolation (no Google / org wiring). Each test wires
// the desired isWindowFree / alternativesNear behaviour.
function fakeCalendar(opts: {
  free?: boolean;
  alternatives?: Slot[];
}): SchedulingCalendar {
  return {
    async isWindowFree() {
      return { configured: true, free: opts.free ?? false, reason: null };
    },
    async alternativesNear() {
      return opts.alternatives ?? [];
    },
    async getOrgTimeZones() {
      return { primary: 'Europe/Berlin', secondary: null };
    },
  };
}

const ORG = 'org-1';
const OFFERED: Slot[] = [
  { start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T09:30:00.000Z' },
  { start: '2026-07-01T14:00:00.000Z', end: '2026-07-01T14:30:00.000Z' },
];

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

  it('(b) counter_time free → ACCEPTED with the counter window', async () => {
    const cal = fakeCalendar({ free: true });
    const counter = '2026-07-02T10:00:00.000Z';
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: null, counter_time: counter },
      OFFERED,
    );
    expect(res).toEqual({
      status: 'ACCEPTED',
      acceptedSlot: { start: counter, end: '2026-07-02T10:30:00.000Z' },
    });
  });

  it('(c) counter_time busy → COUNTER with alternatives', async () => {
    const alternatives: Slot[] = [
      { start: '2026-07-02T11:00:00.000Z', end: '2026-07-02T11:30:00.000Z' },
    ];
    const cal = fakeCalendar({ free: false, alternatives });
    const counter = '2026-07-02T10:00:00.000Z';
    const res = await resolveScheduling(
      cal,
      ORG,
      { accepted_index: null, counter_time: counter },
      OFFERED,
    );
    expect(res).toEqual({ status: 'COUNTER', alternatives, counterTime: counter });
  });
});
