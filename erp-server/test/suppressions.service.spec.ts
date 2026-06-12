import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { SuppressionsService } from '../src/outreach/suppressions.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Suppressions DO carry organizationId, so the fake matches it directly. Seed both
// orgs so list/delete genuinely confine to the caller's org.
function seed() {
  const suppressions = new FakeTable([
    { id: 's-a1', organizationId: ORG_A, email: 'x@aco.com', reason: 'bounced', sourceProspectId: null, __seq: 1 },
    { id: 's-a2', organizationId: ORG_A, email: 'y@aco.com', reason: null, sourceProspectId: null, __seq: 2 },
    { id: 's-b1', organizationId: ORG_B, email: 'z@bco.com', reason: null, sourceProspectId: null, __seq: 3 },
  ]);
  const prospects = new FakeTable([]);
  const campaigns = new FakeTable([]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.suppressions, suppressions],
      [schema.prospects, prospects],
      [schema.campaigns, campaigns],
      [schema.auditLog, auditLog],
    ]),
  );
  return { service: new SuppressionsService(db), suppressions };
}

describe('SuppressionsService — JWT list + delete (org-scoped)', () => {
  it('listForOrg returns only the caller-org rows', async () => {
    const { service } = seed();
    const a = await service.listForOrg(ORG_A);
    expect(a.map((r) => r.id).sort()).toEqual(['s-a1', 's-a2']);
    const b = await service.listForOrg(ORG_B);
    expect(b.map((r) => r.id)).toEqual(['s-b1']);
  });

  it('deleteForOrg removes one row in-org', async () => {
    const { service, suppressions } = seed();
    const res = await service.deleteForOrg(ORG_A, 's-a1');
    expect(res).toEqual({ deleted: true });
    expect(suppressions.rows.find((r) => r.id === 's-a1')).toBeUndefined();
    // The org's other row is untouched.
    expect(suppressions.rows.find((r) => r.id === 's-a2')).toBeDefined();
  });

  it('deleteForOrg 404s a cross-org id and leaves the row intact', async () => {
    const { service, suppressions } = seed();
    // s-b1 belongs to ORG_B — ORG_A must not delete it.
    await expect(
      service.deleteForOrg(ORG_A, 's-b1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(suppressions.rows.find((r) => r.id === 's-b1')).toBeDefined();
  });

  it('deleteForOrg 404s an unknown id', async () => {
    const { service } = seed();
    await expect(
      service.deleteForOrg(ORG_A, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
