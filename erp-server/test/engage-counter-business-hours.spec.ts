import { resolveScheduling, type SchedulingCalendar } from '../src/engage/meeting-loop';

// A fake calendar: `free` controls isWindowFree; alternativesNear returns one slot so a
// COUNTER is observable; getOrgTimeZones drives the business-hours check's timezone.
function cal(free: boolean): SchedulingCalendar & {
  getOrgTimeZones(orgId: string): Promise<{ primary: string; secondary: string | null }>;
} {
  return {
    async isWindowFree() {
      return { configured: true, free, reason: null };
    },
    async alternativesNear() {
      return [{ start: '2026-06-26T08:00:00.000Z', end: '2026-06-26T08:30:00.000Z' }];
    },
    async getOrgTimeZones() {
      return { primary: 'Europe/Berlin', secondary: 'Asia/Bangkok' };
    },
  } as never;
}

const verdict = (counter_time: string | null, accepted_index: number | null = null) => ({
  accepted_index,
  counter_time,
});

describe('resolveScheduling — business-hours gate on counter-proposed times', () => {
  it('auto-accepts a FREE counter-time inside business hours (Fri 10:00 Berlin)', async () => {
    const r = await resolveScheduling(cal(true), 'org', verdict('2026-06-26T08:00:00Z'), []);
    expect(r.status).toBe('ACCEPTED');
  });

  it('does NOT auto-accept a free 02:15 Berlin counter-time — returns COUNTER with alternatives', async () => {
    const r = await resolveScheduling(cal(true), 'org', verdict('2026-06-25T00:15:00Z'), []);
    expect(r.status).toBe('COUNTER');
  });

  it('does NOT auto-accept on a weekend even when free (Sat 10:00 Berlin)', async () => {
    const r = await resolveScheduling(cal(true), 'org', verdict('2026-06-27T08:00:00Z'), []);
    expect(r.status).toBe('COUNTER');
  });

  it('treats an unparseable counter-time as no usable time (NONE — lets the propose path offer slots)', async () => {
    const r = await resolveScheduling(cal(true), 'org', verdict('not-a-date'), []);
    expect(r.status).toBe('NONE');
  });

  it('still honors an explicitly-offered slot via accepted_index regardless of hour', async () => {
    const slots = [{ start: '2026-06-25T00:15:00Z', end: '2026-06-25T00:45:00Z' }];
    const r = await resolveScheduling(cal(true), 'org', verdict(null, 0), slots);
    expect(r.status).toBe('ACCEPTED');
  });
});
