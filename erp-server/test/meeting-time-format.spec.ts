import { formatMeetingTimeBlock } from '../src/engage/meeting-time-format';

// No hardcoded day/time: generate slots dynamically and assert the rendering RULES, not
// a specific value — a weekday/date line, a clock time, and (with a secondary zone) two
// genuinely different GMT offsets.
function slotAfter(days: number) {
  const start = new Date(Date.now() + days * 86_400_000);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 1_800_000).toISOString(),
  };
}

describe('formatMeetingTimeBlock', () => {
  it('renders one slot in the primary zone with a distinct cross-reference zone', () => {
    const out = formatMeetingTimeBlock([slotAfter(2)], 'Europe/Berlin', 'Asia/Bangkok');
    expect(out).toMatch(/day, \d{1,2} \w+ \d{4}/); // "<weekday>, <day> <month> <year>"
    expect(out).toMatch(/\d{2}:\d{2}/); // a clock time
    const offsets = out.match(/GMT[+-]\d+/g) ?? [];
    expect(offsets.length).toBe(2);
    expect(offsets[0]).not.toBe(offsets[1]); // primary vs cross-ref are different zones
  });

  it('omits the cross-reference when there is no secondary zone', () => {
    const out = formatMeetingTimeBlock([slotAfter(2)], 'Europe/Berlin', null);
    expect((out.match(/GMT[+-]\d+/g) ?? []).length).toBe(1);
  });

  it('lists each slot on its own line when several are proposed', () => {
    const out = formatMeetingTimeBlock(
      [slotAfter(2), slotAfter(3)],
      'Europe/Berlin',
      'Asia/Bangkok',
    );
    expect(out.trim().split('\n').length).toBe(2);
  });
});
