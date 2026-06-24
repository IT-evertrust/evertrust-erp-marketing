import { withMeetingTime } from '../src/engage/engage-replies.service';

const SLOT = { start: '2026-06-25T07:30:00.000Z', end: '2026-06-25T08:00:00.000Z' }; // 09:30 Berlin

describe('withMeetingTime', () => {
  it('appends one marker-delimited time block grounded in the slot', () => {
    const body = withMeetingTime(
      'Hi Anna,\n\nLooking forward to it!',
      [SLOT],
      'Europe/Berlin',
      'Asia/Bangkok',
    );
    expect(body).toContain('09:30'); // real slot time, not invented
    expect(body).toContain('GMT+2');
    expect(body).toContain('GMT+7');
    expect((body.match(/<!--meeting-time-->/g) ?? []).length).toBe(1); // exactly one block
  });

  it('is idempotent — re-applying replaces, never duplicates, the block', () => {
    const once = withMeetingTime('Body', [SLOT], 'Europe/Berlin', 'Asia/Bangkok');
    const twice = withMeetingTime(once, [SLOT], 'Europe/Berlin', 'Asia/Bangkok');
    expect((twice.match(/<!--meeting-time-->/g) ?? []).length).toBe(1);
    expect(twice).toContain('09:30');
  });

  it('returns the body unchanged when there are no slots', () => {
    expect(withMeetingTime('Just text', [], 'Europe/Berlin', 'Asia/Bangkok')).toBe('Just text');
  });
});
