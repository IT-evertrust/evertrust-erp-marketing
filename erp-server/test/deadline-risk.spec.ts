import {
  computeDeadlineRisk,
  DEADLINE_ESCALATION_DAYS,
  REMINDER_CADENCE_DAYS,
} from '@evertrust/shared';

// WHY: R31's deadline safety is a compliance-grade rule — a missed T-2 escalation
// means a tender can blow its submission deadline silently. These tests pin the
// exact day→escalation mapping (T-2→MANAGER, T-1→ADMIN, T-0/overdue→SUPER_ADMIN) and closed /
// deadline-less tenders never raise a false alarm. The rule is deterministic:
// `now` is injected, so every band is asserted against a fixed clock.
const NOW = new Date('2026-06-01T12:00:00Z');
const DAY = 86_400_000;
// A deadline `days` whole-days ahead of NOW. The +1h keeps us off the integer
// floor boundary, so each test pins the BAND, not the rounding edge.
const inDays = (days: number) =>
  new Date(NOW.getTime() + days * DAY + 3_600_000).toISOString();

describe('computeDeadlineRisk — Phase 6 (R31) deadline safety + escalation', () => {
  it('no deadline → not at risk', () => {
    expect(computeDeadlineRisk(null, NOW, 'DOCUMENTS')).toMatchObject({
      hasDeadline: false,
      atRisk: false,
      escalateTo: 'NONE',
      level: 'NONE',
      daysRemaining: null,
    });
  });

  it('a closed tender is never at risk, even with an imminent deadline', () => {
    for (const status of ['SUBMITTED', 'AWARDED', 'LOST'] as const) {
      const r = computeDeadlineRisk(inDays(0), NOW, status);
      expect(r.atRisk).toBe(false);
      expect(r.escalateTo).toBe('NONE');
      expect(r.daysRemaining).toBeNull();
    }
  });

  it('far out → SAFE, no escalation', () => {
    expect(computeDeadlineRisk(inDays(10), NOW, 'PIC_PRICING')).toMatchObject({
      atRisk: false,
      escalateTo: 'NONE',
      level: 'SAFE',
      daysRemaining: 10,
    });
  });

  it('inside the reminder window but before T-2 → DUE_SOON, no escalation', () => {
    const preEscalation = REMINDER_CADENCE_DAYS.filter(
      (d) => d > DEADLINE_ESCALATION_DAYS.MANAGER,
    );
    expect(preEscalation.length).toBeGreaterThan(0); // T-5, T-3
    for (const d of preEscalation) {
      const r = computeDeadlineRisk(inDays(d), NOW, 'DOCUMENTS');
      expect(r.level).toBe('DUE_SOON');
      expect(r.escalateTo).toBe('NONE');
      expect(r.atRisk).toBe(false);
    }
  });

  it('T-2 escalates to MANAGER (the deadline-safety trigger)', () => {
    expect(computeDeadlineRisk(inDays(2), NOW, 'DOCUMENTS')).toMatchObject({
      atRisk: true,
      escalateTo: 'MANAGER',
      level: 'AT_RISK',
      daysRemaining: 2,
    });
  });

  it('T-1 escalates to ADMIN', () => {
    expect(computeDeadlineRisk(inDays(1), NOW, 'DOCUMENTS')).toMatchObject({
      atRisk: true,
      escalateTo: 'ADMIN',
      daysRemaining: 1,
    });
  });

  it('T-0 (due today) escalates to SUPER_ADMIN', () => {
    expect(computeDeadlineRisk(inDays(0), NOW, 'DOCUMENTS')).toMatchObject({
      atRisk: true,
      escalateTo: 'SUPER_ADMIN',
      level: 'AT_RISK',
      daysRemaining: 0,
    });
  });

  it('overdue → OVERDUE, escalates to SUPER_ADMIN', () => {
    const r = computeDeadlineRisk(
      new Date(NOW.getTime() - 3_600_000).toISOString(),
      NOW,
      'DOCUMENTS',
    );
    expect(r.level).toBe('OVERDUE');
    expect(r.escalateTo).toBe('SUPER_ADMIN');
    expect(r.atRisk).toBe(true);
    expect(r.daysRemaining).toBeLessThan(0);
  });
});
