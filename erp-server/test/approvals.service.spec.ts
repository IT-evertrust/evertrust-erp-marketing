import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T_A = 'a1111111-1111-1111-1111-111111111111'; // org A
const T_B = 'b2222222-2222-2222-2222-222222222222'; // org B
const PIC = 'd1111111-1111-1111-1111-111111111111';
const DECIDER = 'd2222222-2222-2222-2222-222222222222';

// Two tenders (one per org) + an empty approval_requests table. approval_requests
// carries no organizationId; tenancy is inherited via the owning tender, exactly
// as the service queries it.
function seed() {
  const tenders = new FakeTable([
    {
      id: T_A,
      organizationId: ORG_A,
      vergabeId: 'EXT-A',
      source: 'PORTAL',
      title: 'Org A tender',
      status: 'CUSTOMER_PRICING',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      __seq: 1,
    },
    {
      id: T_B,
      organizationId: ORG_B,
      vergabeId: 'EXT-B',
      source: 'PORTAL',
      title: 'Org B tender',
      status: 'CUSTOMER_PRICING',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      __seq: 2,
    },
  ]);
  const approvalRequests = new FakeTable([]);

  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.approvalRequests, approvalRequests],
    ]),
  );
  return { approvals: new ApprovalsService(db), tenders, approvalRequests };
}

describe('ApprovalsService — request', () => {
  // WHY: the server owns status (PENDING) and requestedBy; the request is the
  // record of "we asked the customer", later decided to satisfy the gate.
  it('opens a PENDING CUSTOMER request stamped with requestedBy', async () => {
    const { approvals } = seed();
    const row = await approvals.request(ORG_A, T_A, { type: 'CUSTOMER' }, PIC);
    expect(row.status).toBe('PENDING');
    expect(row.type).toBe('CUSTOMER');
    expect(row.tenderId).toBe(T_A);
    expect(row.requestedBy).toBe(PIC);
    expect(row.decidedBy).toBeFalsy();
  });

  it('404s when requesting on a tender owned by another org (no cross-org write)', async () => {
    const { approvals } = seed();
    await expect(
      approvals.request(ORG_B, T_A, { type: 'CUSTOMER' }, PIC),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ApprovalsService — decide', () => {
  // WHY: the decision is what the submission gate reads. It must stamp the
  // decider + time and persist the channel-agnostic evidence reference.
  it('records APPROVED + decidedBy and keeps request-time evidence when none supplied', async () => {
    const { approvals } = seed();
    const req = await approvals.request(
      ORG_A,
      T_A,
      { type: 'CUSTOMER', evidenceUrl: 'phone 2026-05-30, confirmed by Müller' },
      PIC,
    );

    const { before, after } = await approvals.decide(
      ORG_A,
      req.id,
      { decision: 'APPROVED' },
      DECIDER,
    );

    expect(before.status).toBe('PENDING');
    expect(after.status).toBe('APPROVED');
    expect(after.decidedBy).toBe(DECIDER);
    expect(after.decidedAt).toBeInstanceOf(Date);
    // No new evidence supplied at decision time → the request-time note is kept.
    expect(after.evidenceUrl).toBe('phone 2026-05-30, confirmed by Müller');
  });

  it('overwrites evidence when supplied at decision time', async () => {
    const { approvals } = seed();
    const req = await approvals.request(ORG_A, T_A, { type: 'CUSTOMER' }, PIC);
    const { after } = await approvals.decide(
      ORG_A,
      req.id,
      { decision: 'APPROVED', evidenceUrl: 'https://mail/thread/42' },
      DECIDER,
    );
    expect(after.evidenceUrl).toBe('https://mail/thread/42');
  });

  it('404s deciding an approval whose tender is in another org', async () => {
    const { approvals } = seed();
    const req = await approvals.request(ORG_A, T_A, { type: 'CUSTOMER' }, PIC);
    await expect(
      approvals.decide(ORG_B, req.id, { decision: 'APPROVED' }, DECIDER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s deciding a non-existent approval', async () => {
    const { approvals } = seed();
    await expect(
      approvals.decide(ORG_A, T_B, { decision: 'REJECTED' }, DECIDER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ApprovalsService — listForTender', () => {
  it('lists the tender approvals and 404s across orgs', async () => {
    const { approvals } = seed();
    await approvals.request(ORG_A, T_A, { type: 'CUSTOMER' }, PIC);
    expect(await approvals.listForTender(ORG_A, T_A)).toHaveLength(1);
    await expect(
      approvals.listForTender(ORG_B, T_A),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
