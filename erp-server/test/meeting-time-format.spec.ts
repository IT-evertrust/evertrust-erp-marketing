import { renderMeetingProse } from '../src/engage/meeting-time-format';

// No hardcoded day/time: generate slots dynamically and assert the rendering RULES (a
// time, two distinct GMT offsets, the right phrasing per kind, one bullet per slot).
function slotAfter(days: number) {
  const start = new Date(Date.now() + days * 86_400_000);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 1_800_000).toISOString(),
  };
}
const bullets = (s: string) => (s.match(/•/g) ?? []).length;
const offsets = (s: string) => (s.match(/GMT[+-]\d+/g) ?? []).length;

describe('renderMeetingProse', () => {
  it('propose, one slot: a natural offer with a time and a distinct cross-reference zone', () => {
    const out = renderMeetingProse([slotAfter(2)], 'Europe/Berlin', 'Asia/Bangkok', 'propose');
    expect(out).toMatch(/would .* work for you/i);
    expect(out).toMatch(/\d{2}:\d{2}/); // a clock time
    expect(offsets(out)).toBe(2); // primary + cross-ref
    expect(bullets(out)).toBe(0); // single slot, no bullets
    expect(out).not.toContain('Proposed time:'); // not the old raw block
    expect(out).not.toContain('<!--'); // no markers in the prose itself
  });

  it('propose, two slots: "either of these" with one bullet per slot', () => {
    const out = renderMeetingProse(
      [slotAfter(2), slotAfter(3)],
      'Europe/Berlin',
      'Asia/Bangkok',
      'propose',
    );
    expect(out).toMatch(/either of these/i);
    expect(bullets(out)).toBe(2);
    expect(offsets(out)).toBe(4); // 2 slots × (primary + cross-ref)
  });

  it('accept: confirms the booking, no "would this work"', () => {
    const out = renderMeetingProse([slotAfter(2)], 'Europe/Berlin', 'Asia/Bangkok', 'accept');
    expect(out).toMatch(/all set|calendar invite/i);
    expect(out).not.toMatch(/would .* work/i);
  });

  it('counter, two slots: offers alternatives after a taken time', () => {
    const out = renderMeetingProse(
      [slotAfter(2), slotAfter(3)],
      'Europe/Berlin',
      'Asia/Bangkok',
      'counter',
    );
    expect(out).toMatch(/just taken|instead/i);
    expect(bullets(out)).toBe(2);
  });

  it('omits the cross-reference when there is no secondary zone', () => {
    const out = renderMeetingProse([slotAfter(2)], 'Europe/Berlin', null, 'propose');
    expect(offsets(out)).toBe(1);
  });

  it('returns empty string when there are no slots', () => {
    expect(renderMeetingProse([], 'Europe/Berlin', 'Asia/Bangkok', 'propose')).toBe('');
  });
});
