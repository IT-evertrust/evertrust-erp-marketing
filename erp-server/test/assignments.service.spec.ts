import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { AssignmentsService } from '../src/tenders/assignments.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TENDER_A = 'a1111111-1111-1111-1111-111111111111';
const PIC_A1 = 'c1111111-1111-1111-1111-111111111111';
const PIC_A2 = 'c2222222-2222-2222-2222-222222222222';
const PIC_B = 'd9999999-9999-9999-9999-999999999999';

// One tender in org A; two PICs in org A and one PIC in org B (the cross-org one).
function seeded(initialAssignments: Record<string, unknown>[] = []) {
  const tenders = new FakeTable([
    {
      id: TENDER_A,
      organizationId: ORG_A,
      title: 'Org A tender',
      status: 'NOT_STARTED',
      __seq: 1,
    },
  ]);
  const users = new FakeTable([
    { id: PIC_A1, organizationId: ORG_A, name: 'Alice', role: 'EMPLOYEE' },
    { id: PIC_A2, organizationId: ORG_A, name: 'Bob', role: 'EMPLOYEE' },
    { id: PIC_B, organizationId: ORG_B, name: 'Mallory', role: 'EMPLOYEE' },
  ]);
  const assignments = new FakeTable(initialAssignments);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.users, users],
      [schema.assignments, assignments],
    ]),
  );
  return { service: new AssignmentsService(db), assignments };
}

describe('AssignmentsService — assign', () => {
  // WHY (R21): re-assigning must leave at most ONE ACTIVE row — the prior ACTIVE
  // assignment is superseded (status REASSIGNED), and a new ACTIVE row is added.
  it('supersedes the prior ACTIVE assignment when reassigning', async () => {
    const { service, assignments } = seeded([
      {
        id: 'e0000000-0000-0000-0000-000000000001',
        tenderId: TENDER_A,
        picId: PIC_A1,
        workloadScore: '0',
        reason: 'first',
        status: 'ACTIVE',
        assignedAt: new Date('2026-01-01T00:00:00Z'),
        __seq: 1,
      },
    ]);

    const result = await service.assign(ORG_A, TENDER_A, PIC_A2, 'second');

    expect(result.picId).toBe(PIC_A2);
    expect(result.picName).toBe('Bob');
    expect(result.status).toBe('ACTIVE');

    // Exactly one ACTIVE row remains, and it is the new one; the old is REASSIGNED.
    const active = assignments.rows.filter((r) => r.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0]!.picId).toBe(PIC_A2);
    const prior = assignments.rows.find((r) => r.picId === PIC_A1);
    expect(prior!.status).toBe('REASSIGNED');
  });

  // WHY: tenancy is the security boundary — a PIC from another org must never be
  // assignable, even though the user id is otherwise valid.
  it('rejects a picId that belongs to another org (400, no row written)', async () => {
    const { service, assignments } = seeded();
    await expect(
      service.assign(ORG_A, TENDER_A, PIC_B),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assignments.rows).toHaveLength(0);
  });

  // WHY: assigning a tender outside the caller's org is indistinguishable from
  // "missing" (404), never a cross-tenant write.
  it('throws NotFound for a tender outside the org', async () => {
    const { service } = seeded();
    await expect(
      service.assign(ORG_B, TENDER_A, PIC_B),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AssignmentsService — getActive', () => {
  it('returns null when the tender has no ACTIVE assignment', async () => {
    const { service } = seeded();
    expect(await service.getActive(ORG_A, TENDER_A)).toBeNull();
  });

  it('returns the ACTIVE assignment with the joined PIC name', async () => {
    const { service } = seeded([
      {
        id: 'e0000000-0000-0000-0000-000000000002',
        tenderId: TENDER_A,
        picId: PIC_A1,
        workloadScore: '0',
        reason: null,
        status: 'ACTIVE',
        assignedAt: new Date('2026-01-01T00:00:00Z'),
        __seq: 1,
      },
    ]);
    const active = await service.getActive(ORG_A, TENDER_A);
    expect(active?.picId).toBe(PIC_A1);
    expect(active?.picName).toBe('Alice');
  });
});
