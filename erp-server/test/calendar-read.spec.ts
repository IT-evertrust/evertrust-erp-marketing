import { computeWindowFree, pickNearest } from '../src/google/google-calendar-read.service';
describe('computeWindowFree', () => {
  const busy = [{ start: '2026-06-25T10:00:00Z', end: '2026-06-25T11:00:00Z' }];
  it('false when overlapping a busy block', () => {
    expect(computeWindowFree(busy, '2026-06-25T10:30:00Z', '2026-06-25T11:30:00Z')).toBe(false);
  });
  it('true when clear', () => {
    expect(computeWindowFree(busy, '2026-06-25T12:00:00Z', '2026-06-25T12:30:00Z')).toBe(true);
  });
});
describe('pickNearest', () => {
  it('picks the 3 closest to the requested time', () => {
    const slots = [
      { start: '2026-06-25T09:00:00Z', end: '2026-06-25T09:30:00Z' },
      { start: '2026-06-25T15:00:00Z', end: '2026-06-25T15:30:00Z' },
      { start: '2026-06-25T16:00:00Z', end: '2026-06-25T16:30:00Z' },
      { start: '2026-06-26T09:00:00Z', end: '2026-06-26T09:30:00Z' },
    ];
    const near = pickNearest(slots, '2026-06-25T15:15:00Z', 3);
    expect(near[0]?.start).toBe('2026-06-25T15:00:00Z');
    expect(near.length).toBe(3);
  });
});
