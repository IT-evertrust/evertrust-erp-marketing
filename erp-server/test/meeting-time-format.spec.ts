import { formatMeetingTimeBlock } from '../src/engage/meeting-time-format';

const SLOT = { start: '2026-06-25T07:30:00.000Z', end: '2026-06-25T08:00:00.000Z' }; // 09:30–10:00 Berlin

describe('formatMeetingTimeBlock', () => {
  it('renders one slot in primary tz with a GMT+7 cross-reference', () => {
    const out = formatMeetingTimeBlock([SLOT], 'Europe/Berlin', 'Asia/Bangkok');
    expect(out).toContain('Thursday, 25 June 2026');
    expect(out).toContain('09:30'); // primary local time
    expect(out).toContain('GMT+2'); // primary offset label
    expect(out).toContain('14:30'); // GMT+7 cross-reference time
    expect(out).toContain('GMT+7'); // secondary offset label
  });

  it('omits the cross-reference when there is no secondary zone', () => {
    const out = formatMeetingTimeBlock([SLOT], 'Europe/Berlin', null);
    expect(out).toContain('09:30');
    expect(out).toContain('GMT+2');
    expect(out).not.toContain('GMT+7');
  });

  it('lists each slot on its own line when several are proposed', () => {
    const out = formatMeetingTimeBlock(
      [SLOT, { start: '2026-06-26T13:00:00.000Z', end: '2026-06-26T13:30:00.000Z' }],
      'Europe/Berlin',
      'Asia/Bangkok',
    );
    expect(out.trim().split('\n').length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('25 June 2026');
    expect(out).toContain('26 June 2026');
  });
});
