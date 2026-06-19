import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { SuppressionsService } from '../src/outreach/suppressions.service';
import { getDb, rowsOf, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Real UUIDs for the seeded suppression rows so a test can assert on a specific id
// or pass it back into deleteForOrg (the DB rejects non-uuid PKs).
const S_A1 = 'a1aaaaaa-0000-0000-0000-000000000001';
const S_A2 = 'a2aaaaaa-0000-0000-0000-000000000002';
const S_B1 = 'b1bbbbbb-0000-0000-0000-000000000003';

// Suppressions DO carry organizationId. Seed both orgs so list/delete genuinely
// confine to the caller's org. (email + organizationId are NOT NULL.)
async function seedRows() {
  await seed(schema.suppressions, [
    { id: S_A1, organizationId: ORG_A, email: 'x@aco.com', reason: 'bounced', sourceProspectId: null },
    { id: S_A2, organizationId: ORG_A, email: 'y@aco.com', reason: null, sourceProspectId: null },
    { id: S_B1, organizationId: ORG_B, email: 'z@bco.com', reason: null, sourceProspectId: null },
  ]);
  return { service: new SuppressionsService(getDb()) };
}

describe('SuppressionsService — JWT list + delete (org-scoped)', () => {
  it('listForOrg returns only the caller-org rows', async () => {
    const { service } = await seedRows();
    const a = await service.listForOrg(ORG_A);
    expect(a.map((r) => r.id).sort()).toEqual([S_A1, S_A2].sort());
    const b = await service.listForOrg(ORG_B);
    expect(b.map((r) => r.id)).toEqual([S_B1]);
  });

  it('deleteForOrg removes one row in-org', async () => {
    const { service } = await seedRows();
    const res = await service.deleteForOrg(ORG_A, S_A1);
    expect(res).toEqual({ deleted: true });
    const rows = await rowsOf(schema.suppressions);
    expect(rows.find((r) => r.id === S_A1)).toBeUndefined();
    // The org's other row is untouched.
    expect(rows.find((r) => r.id === S_A2)).toBeDefined();
  });

  it('deleteForOrg 404s a cross-org id and leaves the row intact', async () => {
    const { service } = await seedRows();
    // S_B1 belongs to ORG_B — ORG_A must not delete it.
    await expect(
      service.deleteForOrg(ORG_A, S_B1),
    ).rejects.toBeInstanceOf(NotFoundException);
    const rows = await rowsOf(schema.suppressions);
    expect(rows.find((r) => r.id === S_B1)).toBeDefined();
  });

  it('deleteForOrg 404s an unknown id', async () => {
    const { service } = await seedRows();
    await expect(
      service.deleteForOrg(ORG_A, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
