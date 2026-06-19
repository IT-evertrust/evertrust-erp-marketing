import { ConflictException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { IndustriesService } from '../src/industries/industries.service';
import { eq } from 'drizzle-orm';
import { getDb, rowsOf, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const IND_A = '11111111-1111-1111-1111-111111111111';
const IND_B = '22222222-2222-2222-2222-222222222222';
const NICHE_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// Industries are org-scoped; niches optionally point at an industry via
// niches.industry_id. Seeds an industry per org so cross-org assertions exercise the
// real org lookup, plus a niche assigned to IND_A for the delete guard.
async function setup() {
  await seed(schema.industries, [
    { id: IND_A, organizationId: ORG_A, name: 'Construction', slug: 'construction' },
    { id: IND_B, organizationId: ORG_B, name: 'Logistics', slug: 'logistics' },
  ]);
  await seed(schema.niches, [
    { id: NICHE_A, organizationId: ORG_A, name: 'Roofing', slug: 'roofing', industryId: IND_A },
  ]);
  return { service: new IndustriesService(getDb()) };
}

describe('IndustriesService — CRUD + delete guard (org-scoped)', () => {
  it('findOrCreate dedups by (org, slug) — second call returns the same row', async () => {
    const { service } = await setup();
    const a = await service.findOrCreate(ORG_A, 'Healthcare');
    expect(a.slug).toBe('healthcare');
    expect(a.name).toBe('Healthcare');
    const again = await service.findOrCreate(ORG_A, 'healthcare'); // same slug
    expect(again.id).toBe(a.id);
    expect(
      (await rowsOf(schema.industries)).filter((r) => r.slug === 'healthcare'),
    ).toHaveLength(1);
  });

  it('create is a deduped find-or-create', async () => {
    const { service } = await setup();
    const created = await service.create(ORG_A, 'Manufacturing');
    expect(created.slug).toBe('manufacturing');
    const dup = await service.create(ORG_A, 'Manufacturing');
    expect(dup.id).toBe(created.id);
    expect(
      (await rowsOf(schema.industries)).filter((r) => r.slug === 'manufacturing'),
    ).toHaveLength(1);
  });

  it('list returns only the caller org, alphabetical', async () => {
    const { service } = await setup();
    const list = await service.list(ORG_A);
    // ORG_A only sees IND_A (Construction); IND_B belongs to ORG_B.
    expect(list.map((i) => i.id)).toEqual([IND_A]);
  });

  it('require 404s a missing / cross-org industry', async () => {
    const { service } = await setup();
    const found = await service.require(ORG_A, IND_A);
    expect(found.id).toBe(IND_A);
    // IND_B belongs to ORG_B — ORG_A must not see it.
    await expect(service.require(ORG_A, IND_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rename re-derives the slug', async () => {
    const { service } = await setup();
    const renamed = await service.rename(ORG_A, IND_A, 'Heavy Construction');
    expect(renamed.name).toBe('Heavy Construction');
    expect(renamed.slug).toBe('heavy-construction');
    expect(
      (await rowsOf(schema.industries)).find((r) => r.id === IND_A)!.slug,
    ).toBe('heavy-construction');
  });

  it('rename 404s a cross-org industry', async () => {
    const { service } = await setup();
    await expect(
      service.rename(ORG_A, IND_B, 'Whatever'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listWithCounts reports per-industry nicheCount, org-scoped', async () => {
    const { service } = await setup();
    const list = await service.listWithCounts(ORG_A);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(IND_A);
    expect(list[0]!.nicheCount).toBe(1); // NICHE_A is assigned to IND_A
  });

  it('delete is BLOCKED with a 409 when a niche is still assigned', async () => {
    const { service } = await setup();
    // IND_A has NICHE_A assigned → 409, and the industry row survives.
    await expect(service.delete(ORG_A, IND_A)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      (await rowsOf(schema.industries)).find((r) => r.id === IND_A),
    ).toBeDefined();
  });

  it('delete succeeds once no niche points at the industry', async () => {
    const { service } = await setup();
    // Unassign the only niche, then the delete clears cleanly.
    await getDb()
      .update(schema.niches)
      .set({ industryId: null })
      .where(eq(schema.niches.id, NICHE_A));
    const deleted = await service.delete(ORG_A, IND_A);
    expect(deleted.id).toBe(IND_A);
    expect(
      (await rowsOf(schema.industries)).find((r) => r.id === IND_A),
    ).toBeUndefined();
  });

  it('delete 404s a cross-org industry (before the guard runs)', async () => {
    const { service } = await setup();
    await expect(service.delete(ORG_A, IND_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rename throws a 409 when the new slug clashes with a sibling industry', async () => {
    const { service } = await setup();
    // A SIBLING in the same org already owns the target slug. The clash-check select
    // uses `ne(id)` to exclude the row being renamed — the real engine models that.
    const SIBLING = '33333333-3333-3333-3333-333333333333';
    await seed(schema.industries, {
      id: SIBLING,
      organizationId: ORG_A,
      name: 'Logistics',
      slug: 'logistics',
    });

    await expect(
      service.rename(ORG_A, IND_A, 'Logistics'),
    ).rejects.toBeInstanceOf(ConflictException);

    // The guard threw BEFORE any update — IND_A keeps its original slug.
    const indA = (await rowsOf(schema.industries)).find((r) => r.id === IND_A);
    expect(indA!.slug).toBe('construction');
  });
});
