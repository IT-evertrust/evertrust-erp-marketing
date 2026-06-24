import { withMeetingTime } from '../src/engage/engage-replies.service';

// No hardcoded day/time: generate a slot dynamically and assert the INVARIANTS of the
// stamped block (one marker-delimited dual-zone block, idempotent, prose preserved,
// no-slot passthrough) rather than a specific rendered value.
function aSlot() {
  const start = new Date(Date.now() + 3 * 86_400_000); // a few days out — any date works
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 1_800_000).toISOString(),
  };
}

describe('withMeetingTime', () => {
  it('stamps exactly one marker-delimited dual-zone block and keeps the prose', () => {
    const body = withMeetingTime(
      'Hi Anna,\n\nLooking forward to it!',
      [aSlot()],
      'Europe/Berlin',
      'Asia/Bangkok',
    );
    expect(body).toContain('Looking forward to it!'); // original prose kept
    expect((body.match(/<!--meeting-time-->/g) ?? []).length).toBe(1); // exactly one block
    expect(body).toMatch(/\d{2}:\d{2}/); // a real rendered time, not invented prose
    const offsets = body.match(/GMT[+-]\d+/g) ?? [];
    expect(offsets.length).toBe(2); // primary + GMT+7 cross-reference
    expect(offsets[0]).not.toBe(offsets[1]); // genuinely two different zones
  });

  it('is idempotent — re-applying replaces, never duplicates, the block', () => {
    const slot = aSlot();
    const once = withMeetingTime('Body', [slot], 'Europe/Berlin', 'Asia/Bangkok');
    const twice = withMeetingTime(once, [slot], 'Europe/Berlin', 'Asia/Bangkok');
    expect((twice.match(/<!--meeting-time-->/g) ?? []).length).toBe(1);
  });

  it('returns the body unchanged when there are no slots', () => {
    expect(withMeetingTime('Just text', [], 'Europe/Berlin', 'Asia/Bangkok')).toBe('Just text');
  });
});
