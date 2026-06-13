import { ConflictException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import type { DbClient } from '../src/db/db.tokens';
import { IndustriesService } from '../src/industries/industries.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const IND_A = '11111111-1111-1111-1111-111111111111';
const IND_B = '22222222-2222-2222-2222-222222222222';
const NICHE_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// Industries are org-scoped; niches optionally point at an industry via
// niches.industry_id. The fake seeds an industry per org so cross-org assertions
// exercise the real org lookup, plus a niche assigned to IND_A for the delete guard.
function seed() {
  const industries = new FakeTable([
    { id: IND_A, organizationId: ORG_A, name: 'Construction', slug: 'construction', __seq: 1 },
    { id: IND_B, organizationId: ORG_B, name: 'Logistics', slug: 'logistics', __seq: 2 },
  ]);
  const niches = new FakeTable([
    { id: NICHE_A, organizationId: ORG_A, name: 'Roofing', slug: 'roofing', industryId: IND_A, __seq: 1 },
  ]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.industries, industries],
      [schema.niches, niches],
    ]),
  );
  return { service: new IndustriesService(db), industries, niches };
}

describe('IndustriesService — CRUD + delete guard (org-scoped)', () => {
  it('findOrCreate dedups by (org, slug) — second call returns the same row', async () => {
    const { service, industries } = seed();
    const a = await service.findOrCreate(ORG_A, 'Healthcare');
    expect(a.slug).toBe('healthcare');
    expect(a.name).toBe('Healthcare');
    const again = await service.findOrCreate(ORG_A, 'healthcare'); // same slug
    expect(again.id).toBe(a.id);
    expect(industries.rows.filter((r) => r.slug === 'healthcare')).toHaveLength(1);
  });

  it('create is a deduped find-or-create', async () => {
    const { service, industries } = seed();
    const created = await service.create(ORG_A, 'Manufacturing');
    expect(created.slug).toBe('manufacturing');
    const dup = await service.create(ORG_A, 'Manufacturing');
    expect(dup.id).toBe(created.id);
    expect(industries.rows.filter((r) => r.slug === 'manufacturing')).toHaveLength(1);
  });

  it('list returns only the caller org, alphabetical', async () => {
    const { service } = seed();
    const list = await service.list(ORG_A);
    // ORG_A only sees IND_A (Construction); IND_B belongs to ORG_B.
    expect(list.map((i) => i.id)).toEqual([IND_A]);
  });

  it('require 404s a missing / cross-org industry', async () => {
    const { service } = seed();
    const found = await service.require(ORG_A, IND_A);
    expect(found.id).toBe(IND_A);
    // IND_B belongs to ORG_B — ORG_A must not see it.
    await expect(service.require(ORG_A, IND_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rename re-derives the slug', async () => {
    const { service, industries } = seed();
    const renamed = await service.rename(ORG_A, IND_A, 'Heavy Construction');
    expect(renamed.name).toBe('Heavy Construction');
    expect(renamed.slug).toBe('heavy-construction');
    expect(industries.rows.find((r) => r.id === IND_A)!.slug).toBe(
      'heavy-construction',
    );
  });

  it('rename 404s a cross-org industry', async () => {
    const { service } = seed();
    await expect(
      service.rename(ORG_A, IND_B, 'Whatever'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listWithCounts reports per-industry nicheCount, org-scoped', async () => {
    const { service } = seed();
    const list = await service.listWithCounts(ORG_A);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(IND_A);
    expect(list[0]!.nicheCount).toBe(1); // NICHE_A is assigned to IND_A
  });

  it('delete is BLOCKED with a 409 when a niche is still assigned', async () => {
    const { service, industries } = seed();
    // IND_A has NICHE_A assigned → 409, and the industry row survives.
    await expect(service.delete(ORG_A, IND_A)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(industries.rows.find((r) => r.id === IND_A)).toBeDefined();
  });

  it('delete succeeds once no niche points at the industry', async () => {
    const { service, industries, niches } = seed();
    // Unassign the only niche, then the delete clears cleanly.
    niches.rows.find((r) => r.id === NICHE_A)!.industryId = null;
    const deleted = await service.delete(ORG_A, IND_A);
    expect(deleted.id).toBe(IND_A);
    expect(industries.rows.find((r) => r.id === IND_A)).toBeUndefined();
  });

  it('delete 404s a cross-org industry (before the guard runs)', async () => {
    const { service } = seed();
    await expect(service.delete(ORG_A, IND_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rename throws a 409 when the new slug clashes with a sibling industry', async () => {
    // The in-memory fake-db cannot model `ne(id)` (it parses as equality), so the
    // cross-row clash select is exercised here against a focused stub whose clash
    // query returns a sibling row — proving the guard throws BEFORE any update and
    // never issues the UPDATE.
    let updateCalled = false;
    const stub = {
      select: () => ({
        from: () => ({
          where: () => ({
            // require() reads one matching industry; the clash-check reads a sibling.
            // Both go through this builder — return a non-empty row for each call so
            // require() finds the target AND the clash select finds a sibling.
            limit: () =>
              Promise.resolve([
                { id: IND_A, organizationId: ORG_A, name: 'Construction', slug: 'construction' },
              ]),
          }),
        }),
      }),
      update: () => {
        updateCalled = true;
        return {
          set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
        };
      },
    } as unknown as DbClient;

    const service = new IndustriesService(stub);
    await expect(
      service.rename(ORG_A, IND_A, 'Logistics'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateCalled).toBe(false);
  });
});
