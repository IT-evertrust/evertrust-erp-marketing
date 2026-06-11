import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { TendersService } from '../src/tenders/tenders.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T_A = 'a1111111-1111-1111-1111-111111111111';
const T_B = 'b2222222-2222-2222-2222-222222222222';

// Seed: one tender in org A (PIC_PRICING) and one in org B (NOT_STARTED). Each
// row carries a __seq for deterministic newest-first ordering.
function seededService() {
  const tenders = new FakeTable([
    {
      id: T_A,
      organizationId: ORG_A,
      vergabeId: 'EXT-A',
      source: 'PORTAL',
      title: 'Org A tender',
      status: 'PIC_PRICING',
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
      status: 'NOT_STARTED',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      __seq: 2,
    },
  ]);
  // approval_requests is registered so the Phase 6 submission gate (which queries
  // it from TendersService.transition) has a table to read; empty by default.
  const approvals = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.approvalRequests, approvals],
    ]),
  );
  return { service: new TendersService(db), tenders, approvals };
}

describe('TendersService — tenant isolation', () => {
  // WHY: tenancy is the security boundary. Org A reading Org B's tender must be
  // indistinguishable from "missing" (404), never a leak.
  it('get() throws NotFound for a tender owned by another org', async () => {
    const { service } = seededService();
    await expect(service.get(ORG_A, T_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('get() returns the tender for its owning org', async () => {
    const { service } = seededService();
    const row = await service.get(ORG_A, T_A);
    expect(row.id).toBe(T_A);
    expect(row.organizationId).toBe(ORG_A);
  });

  it('list() only returns the calling org rows', async () => {
    const { service } = seededService();
    const rows = await service.list(ORG_A);
    expect(rows.map((r) => r.id)).toEqual([T_A]);
  });

  it('transition() on another org tender throws NotFound (no cross-org write)', async () => {
    const { service } = seededService();
    await expect(service.transition(ORG_A, T_B, 'PIC_PRICING')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TendersService — list status filter', () => {
  // WHY: GET /tenders?status= must filter inside the tenant, not across it.
  it('filters by status', async () => {
    const { service } = seededService();
    expect(await service.list(ORG_A, 'PIC_PRICING')).toHaveLength(1);
    expect(await service.list(ORG_A, 'AWARDED')).toHaveLength(0);
  });
});

describe('TendersService — create', () => {
  // WHY: the server, not the client, owns organizationId and the initial status.
  it('stamps organizationId and status=NOT_STARTED on create', async () => {
    const { service } = seededService();
    const created = await service.create(ORG_A, {
      vergabeId: 'NEW-1',
      source: 'PORTAL',
      title: 'Fresh tender',
    });
    expect(created.organizationId).toBe(ORG_A);
    expect(created.status).toBe('NOT_STARTED');
    expect(created.title).toBe('Fresh tender');
  });
});

describe('TendersService — transition state machine', () => {
  // WHY: legal moves must persist; illegal moves must 400 and NOT mutate state.
  // T_A starts in PIC_PRICING.
  it('performs a legal transition (PIC_PRICING -> CUSTOMER_PRICING)', async () => {
    const { service } = seededService();
    const { before, after } = await service.transition(
      ORG_A,
      T_A,
      'CUSTOMER_PRICING',
    );
    expect(before.status).toBe('PIC_PRICING');
    expect(after.status).toBe('CUSTOMER_PRICING');
  });

  it('rejects an illegal transition (PIC_PRICING -> AWARDED) with BadRequest', async () => {
    const { service } = seededService();
    await expect(service.transition(ORG_A, T_A, 'AWARDED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // state unchanged after the rejected transition
    expect((await service.get(ORG_A, T_A)).status).toBe('PIC_PRICING');
  });
});

describe('TendersService — transition refuses a direct → SUBMITTED (Phase 7)', () => {
  // WHY: SUBMITTED is reached ONLY through POST /tenders/:id/submit
  // (SubmissionService), which enforces the customer-approval + conditional-QC gates
  // AND logs the submission receipt. So the generic transition must refuse a direct
  // → SUBMITTED (keeping the invariant SUBMITTED ⟺ a logged receipt). The full gate
  // behaviour is covered in submission.service.spec.ts.
  function atDocuments() {
    const ctx = seededService();
    ctx.tenders.rows[0]!.status = 'DOCUMENTS';
    return ctx;
  }

  it('rejects DOCUMENTS -> SUBMITTED via the generic transition and leaves state unchanged', async () => {
    const { service } = atDocuments();
    await expect(
      service.transition(ORG_A, T_A, 'SUBMITTED'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.get(ORG_A, T_A)).status).toBe('DOCUMENTS');
  });
});

describe('TendersService — deadline risk (Phase 6b / R31)', () => {
  const DAY = 86_400_000;
  const T_C = 'c3333333-3333-3333-3333-333333333333';
  const T_D = 'd4444444-4444-4444-4444-444444444444';

  function tenderRow(over: Record<string, unknown>) {
    return {
      vergabeId: 'EXT',
      source: 'PORTAL',
      title: 'tender',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
  }

  // WHY: R31 is the at-risk worklist the dashboard + n8n both consume. It must
  // surface ONLY open tenders inside the T-2 window, most-urgent-first — a closed
  // tender or another org's tender appearing here would misroute an escalation.
  it('returns only OPEN at-risk tenders for the org, most urgent first', async () => {
    const { service, tenders } = seededService();
    // T_A (org A, PIC_PRICING): ~1.4 days out → at risk.
    tenders.rows[0]!.submissionDeadlineAt = new Date(Date.now() + 1.4 * DAY);
    // T_C (org A, DOCUMENTS): ~0.4 days out → MORE urgent (must sort first).
    tenders.rows.push(
      tenderRow({
        id: T_C,
        organizationId: ORG_A,
        status: 'DOCUMENTS',
        submissionDeadlineAt: new Date(Date.now() + 0.4 * DAY),
        __seq: 3,
      }),
    );
    // T_D (org A, SUBMITTED): imminent deadline but CLOSED → excluded.
    tenders.rows.push(
      tenderRow({
        id: T_D,
        organizationId: ORG_A,
        status: 'SUBMITTED',
        submissionDeadlineAt: new Date(Date.now() + 0.2 * DAY),
        __seq: 4,
      }),
    );

    const risk = await service.deadlineRisk(ORG_A);
    expect(risk.map((r) => r.tender.id)).toEqual([T_C, T_A]);
    expect(risk.every((r) => r.risk.atRisk)).toBe(true);
  });

  it('is tenant-scoped — another org’s imminent deadline never leaks', async () => {
    const { service, tenders } = seededService();
    // T_B is in ORG_B; give it an imminent deadline. ORG_A must not see it, and
    // ORG_A's own T_A has no deadline → the list is empty.
    tenders.rows[1]!.submissionDeadlineAt = new Date(Date.now() + 0.2 * DAY);
    expect(await service.deadlineRisk(ORG_A)).toEqual([]);
  });
});
