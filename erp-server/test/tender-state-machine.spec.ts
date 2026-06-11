import type { TenderStatus } from '@evertrust/shared';
import {
  STATE_MACHINE,
  canTransition,
  isSubmissionBlocked,
} from '../src/tenders/tender-state-machine';

// WHY: the lifecycle is the core domain rule of M1. An illegal transition that
// slips through (or a legal one that gets blocked) corrupts operational state.
// These tests pin the exact adjacency the API + web both depend on.
describe('tender STATE_MACHINE', () => {
  it('allows a defined forward transition (NOT_STARTED -> PIC_PRICING)', () => {
    expect(canTransition('NOT_STARTED', 'PIC_PRICING')).toBe(true);
  });

  it('allows the parallel Track B fork (PIC_PRICING -> DOCUMENTS)', () => {
    expect(canTransition('PIC_PRICING', 'DOCUMENTS')).toBe(true);
  });

  it('allows dropping any non-terminal state to LOST (CUSTOMER_PRICING -> LOST)', () => {
    expect(canTransition('CUSTOMER_PRICING', 'LOST')).toBe(true);
  });

  it('rejects a skip-ahead transition (NOT_STARTED -> SUBMITTED)', () => {
    expect(canTransition('NOT_STARTED', 'SUBMITTED')).toBe(false);
  });

  it('rejects any transition out of a terminal state (AWARDED, LOST)', () => {
    const all: TenderStatus[] = [
      'NOT_STARTED',
      'PIC_PRICING',
      'CUSTOMER_PRICING',
      'DOCUMENTS',
      'SUBMITTED',
      'AWARDED',
      'LOST',
    ];
    for (const to of all) {
      expect(canTransition('AWARDED', to)).toBe(false);
      expect(canTransition('LOST', to)).toBe(false);
    }
    expect(STATE_MACHINE.AWARDED).toHaveLength(0);
    expect(STATE_MACHINE.LOST).toHaveLength(0);
  });

  it('never lists a state as its own successor (no self-loops)', () => {
    for (const [from, tos] of Object.entries(STATE_MACHINE)) {
      expect(tos).not.toContain(from);
    }
  });
});

// WHY: "no written approval → no submission" is the core Phase 6 (R30) compliance
// rule. If this predicate ever returned false for an unapproved →SUBMITTED, a
// tender could be submitted with no recorded customer approval — exactly the
// failure the gate exists to prevent. The rule is channel-agnostic: it asks only
// whether an approval EXISTS (the boolean), never how it arrived.
describe('isSubmissionBlocked — Phase 6 customer-approval gate', () => {
  it('blocks →SUBMITTED when no customer approval is recorded', () => {
    expect(isSubmissionBlocked('SUBMITTED', false)).toBe(true);
  });

  it('allows →SUBMITTED once a customer approval is recorded', () => {
    expect(isSubmissionBlocked('SUBMITTED', true)).toBe(false);
  });

  it('never blocks a non-submission transition, with or without approval', () => {
    const nonSubmit: TenderStatus[] = [
      'NOT_STARTED',
      'PIC_PRICING',
      'CUSTOMER_PRICING',
      'DOCUMENTS',
      'AWARDED',
      'LOST',
    ];
    for (const to of nonSubmit) {
      expect(isSubmissionBlocked(to, false)).toBe(false);
      expect(isSubmissionBlocked(to, true)).toBe(false);
    }
  });
});
