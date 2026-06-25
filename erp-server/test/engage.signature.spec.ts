import { enforceSignature } from '../src/engage/engage-replies.service';

// enforceSignature pins the canonical reply closing: every drafted reply (regardless of
// classification — interested / unsure / temp / not-interested) must end with the exact
// EVERTRUST sign-off, replacing whatever closing the reply_glock LLM produced. PURE — no
// network, no DB. The block lives at the BOTTOM; meeting-time prose sits above it.

const CANON = 'Kind regards,\nHanna Nguyen\nEVERTRUST GmbH\nWe are at your disposal.';

describe('enforceSignature', () => {
  it("replaces the LLM's own sign-off with the canonical block", () => {
    const draft = [
      'Thank you for your reply — happy to help.',
      '',
      'Best regards,',
      'Hanna Nguyen | Business Development Manager | EVERTRUST GmbH',
    ].join('\n');

    const out = enforceSignature(draft);

    expect(out.endsWith(CANON)).toBe(true);
    expect(out).not.toContain('Business Development Manager');
    expect(out.startsWith('Thank you for your reply — happy to help.')).toBe(true);
  });

  it('preserves meeting-time bullets that sit above the sign-off', () => {
    const draft = [
      'Here are a couple of times that work on my end:',
      '• Thursday, 25 June at 09:00 (GMT+2)',
      '• Thursday, 25 June at 09:30 (GMT+2)',
      '',
      'Best regards,',
      'Hanna Nguyen, EVERTRUST GmbH',
    ].join('\n');

    const out = enforceSignature(draft);

    expect(out).toContain('• Thursday, 25 June at 09:00 (GMT+2)');
    expect(out).toContain('• Thursday, 25 June at 09:30 (GMT+2)');
    expect(out.endsWith(CANON)).toBe(true);
  });

  it('is idempotent — an already-canonical draft is unchanged in its ending', () => {
    const draft = `Understood, I will follow up later.\n\n${CANON}`;
    expect(enforceSignature(draft).endsWith(CANON)).toBe(true);
    // running twice yields the same result (no duplicated signature)
    expect(enforceSignature(enforceSignature(draft))).toBe(enforceSignature(draft));
    expect((enforceSignature(draft).match(/Kind regards,/g) ?? []).length).toBe(1);
  });

  it('appends the block when the draft has no recognizable sign-off', () => {
    const out = enforceSignature('Thanks, not interested at this time.');
    expect(out).toBe(`Thanks, not interested at this time.\n\n${CANON}`);
  });

  it('handles a German sign-off too (Mit freundlichen Grüßen)', () => {
    const draft = 'Vielen Dank.\n\nMit freundlichen Grüßen,\nHanna';
    const out = enforceSignature(draft);
    expect(out).not.toContain('Mit freundlichen Grüßen');
    expect(out.endsWith(CANON)).toBe(true);
  });

  it('leaves an empty draft untouched (no reply to sign)', () => {
    expect(enforceSignature('')).toBe('');
    expect(enforceSignature('   \n  ')).toBe('   \n  ');
  });
});
