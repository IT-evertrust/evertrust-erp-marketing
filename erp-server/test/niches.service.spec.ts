import { ConflictException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import type { DbClient } from '../src/db/db.tokens';
import { NichesService } from '../src/niches/niches.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NICHE_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const NICHE_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const IND_A = '11111111-1111-1111-1111-111111111111';
const IND_B = '22222222-2222-2222-2222-222222222222';
const CAMP_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// Seeds the industry-grouping surface: a niche per org, an industry per org, a
// campaign on NICHE_A, and two prospects under that campaign (so prospectCount
// rolls prospect → campaign → niche). NICHE_A starts assigned to IND_A.
function seed() {
  const niches = new FakeTable([
    { id: NICHE_A, organizationId: ORG_A, name: 'Roofing', slug: 'roofing', industryId: IND_A, __seq: 1 },
    { id: NICHE_B, organizationId: ORG_B, name: 'Freight', slug: 'freight', industryId: null, __seq: 2 },
  ]);
  const industries = new FakeTable([
    { id: IND_A, organizationId: ORG_A, name: 'Construction', slug: 'construction', __seq: 1 },
    { id: IND_B, organizationId: ORG_B, name: 'Logistics', slug: 'logistics', __seq: 2 },
  ]);
  const campaigns = new FakeTable([
    { id: CAMP_A, organizationId: ORG_A, nicheId: NICHE_A, __seq: 1 },
  ]);
  const prospects = new FakeTable([
    { id: 'p-1', organizationId: ORG_A, campaignId: CAMP_A, __seq: 1 },
    { id: 'p-2', organizationId: ORG_A, campaignId: CAMP_A, __seq: 2 },
  ]);
  const nicheTargets = new FakeTable([
    { id: 't-a1', nicheId: NICHE_A, name: 'Provider', slug: 'provider', searchHint: null, source: 'AI', enabled: true, __seq: 1 },
  ]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.niches, niches],
      [schema.industries, industries],
      [schema.campaigns, campaigns],
      [schema.prospects, prospects],
      [schema.nicheTargets, nicheTargets],
    ]),
  );
  return {
    service: new NichesService(db),
    niches,
    industries,
    campaigns,
    prospects,
    nicheTargets,
  };
}

describe('NichesService — industry grouping + prospect rollup', () => {
  it('listWithCounts surfaces industryId / industryName per niche', async () => {
    const { service } = seed();
    const list = await service.listWithCounts(ORG_A);
    expect(list).toHaveLength(1); // ORG_A has only NICHE_A
    expect(list[0]!.id).toBe(NICHE_A);
    expect(list[0]!.industryId).toBe(IND_A);
    expect(list[0]!.industryName).toBe('Construction');
  });

  it('listWithCounts reports prospectCount (prospect → campaign → niche)', async () => {
    const { service } = seed();
    const list = await service.listWithCounts(ORG_A);
    expect(list[0]!.prospectCount).toBe(2); // p-1 + p-2 under CAMP_A on NICHE_A
    // The existing rollups still hold.
    expect(list[0]!.targetCount).toBe(1);
    expect(list[0]!.campaignCount).toBe(1);
  });

  it('listWithCounts leaves an unassigned niche with null industry, zero prospects', async () => {
    const { service } = seed();
    const list = await service.listWithCounts(ORG_B); // NICHE_B, unassigned
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(NICHE_B);
    expect(list[0]!.industryId).toBeNull();
    expect(list[0]!.industryName).toBeNull();
    expect(list[0]!.prospectCount).toBe(0);
  });

  it('assignIndustry sets the niche industryId (same org)', async () => {
    const { service, niches } = seed();
    // Re-point NICHE_A onto a fresh in-org industry would need a second industry;
    // here we confirm assigning the existing in-org industry persists.
    const updated = await service.assignIndustry(ORG_A, NICHE_A, IND_A);
    expect(updated.industryId).toBe(IND_A);
    expect(niches.rows.find((r) => r.id === NICHE_A)!.industryId).toBe(IND_A);
  });

  it('assignIndustry with null unassigns the niche', async () => {
    const { service, niches } = seed();
    const updated = await service.assignIndustry(ORG_A, NICHE_A, null);
    expect(updated.industryId).toBeNull();
    expect(niches.rows.find((r) => r.id === NICHE_A)!.industryId).toBeNull();
  });

  it('assignIndustry 404s when the niche is cross-org', async () => {
    const { service, niches } = seed();
    // NICHE_B is ORG_B's — ORG_A cannot assign it.
    await expect(
      service.assignIndustry(ORG_A, NICHE_B, IND_A),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(niches.rows.find((r) => r.id === NICHE_B)!.industryId).toBeNull();
  });

  it('assignIndustry 404s when the industry is cross-org (no cross-tenant link)', async () => {
    const { service, niches } = seed();
    // IND_B belongs to ORG_B — assigning it to ORG_A's niche must 404, and the
    // niche must keep its prior industry (no partial write).
    await expect(
      service.assignIndustry(ORG_A, NICHE_A, IND_B),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(niches.rows.find((r) => r.id === NICHE_A)!.industryId).toBe(IND_A);
  });
});

describe('NichesService — direct CRUD (create / rename / delete, org-scoped)', () => {
  it('createNiche inserts a new niche with the derived slug', async () => {
    const { service, niches } = seed();
    const created = await service.createNiche(ORG_A, '  Solar Installers ');
    expect(created.name).toBe('Solar Installers'); // trimmed display name
    expect(created.slug).toBe('solar-installers');
    expect(created.organizationId).toBe(ORG_A);
    expect(created.industryId ?? null).toBeNull(); // no industry given
    expect(niches.rows.filter((r) => r.slug === 'solar-installers')).toHaveLength(1);
  });

  it('createNiche throws a 409 when the (org, slug) already exists', async () => {
    const { service, niches } = seed();
    // NICHE_A already occupies slug "roofing" in ORG_A — a same-name create is a 409
    // (vs. findOrCreate, which would silently return it) and inserts nothing.
    await expect(service.createNiche(ORG_A, 'Roofing')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(niches.rows.filter((r) => r.slug === 'roofing')).toHaveLength(1);
  });

  it('createNiche assigns an in-org industry on create', async () => {
    const { service } = seed();
    const created = await service.createNiche(ORG_A, 'Facades', IND_A);
    expect(created.industryId).toBe(IND_A);
  });

  it('createNiche 404s when industryId is cross-org (no cross-tenant link)', async () => {
    const { service, niches } = seed();
    const before = niches.rows.length;
    // IND_B belongs to ORG_B — ORG_A cannot link to it, and nothing is inserted.
    await expect(
      service.createNiche(ORG_A, 'Cladding', IND_B),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(niches.rows).toHaveLength(before);
  });

  it('renameNiche re-derives the slug', async () => {
    const { service, niches } = seed();
    const renamed = await service.renameNiche(ORG_A, NICHE_A, 'Metal Roofing');
    expect(renamed.name).toBe('Metal Roofing');
    expect(renamed.slug).toBe('metal-roofing');
    expect(niches.rows.find((r) => r.id === NICHE_A)!.slug).toBe('metal-roofing');
  });

  it('renameNiche 404s a cross-org niche', async () => {
    const { service } = seed();
    // NICHE_B belongs to ORG_B — ORG_A must not rename it.
    await expect(
      service.renameNiche(ORG_A, NICHE_B, 'Whatever'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renameNiche throws a 409 when the new slug clashes with a sibling niche', async () => {
    // The in-memory fake-db cannot model `ne(id)` (it parses as equality), so the
    // cross-row clash select is exercised against a focused stub whose clash query
    // returns a sibling row — proving the guard throws BEFORE any update and never
    // issues the UPDATE.
    let updateCalled = false;
    const stub = {
      select: () => ({
        from: () => ({
          where: () => ({
            // require() reads one matching niche; the clash-check reads a sibling.
            // Both go through this builder — a non-empty row for each call makes
            // require() find the target AND the clash select find a sibling.
            limit: () =>
              Promise.resolve([
                { id: NICHE_A, organizationId: ORG_A, name: 'Roofing', slug: 'roofing' },
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

    const service = new NichesService(stub);
    await expect(
      service.renameNiche(ORG_A, NICHE_A, 'Freight'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateCalled).toBe(false);
  });

  it('deleteNiche is BLOCKED with a 409 when the niche has campaigns / prospects', async () => {
    const { service, niches } = seed();
    // NICHE_A has CAMP_A (1 campaign) + p-1/p-2 (2 prospects) → 409, niche survives.
    await expect(service.deleteNiche(ORG_A, NICHE_A)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(niches.rows.find((r) => r.id === NICHE_A)).toBeDefined();
  });

  it('deleteNiche succeeds and cascades its targets when it has no campaigns / prospects', async () => {
    const { service, niches, nicheTargets } = seed();
    // Give the otherwise-clean NICHE_B (ORG_B, no campaigns/prospects) a target, then
    // delete it: the niche row is gone AND its archetype is cascaded.
    nicheTargets.rows.push({
      id: 't-b1',
      nicheId: NICHE_B,
      name: 'Carrier',
      slug: 'carrier',
      searchHint: null,
      source: 'AI',
      enabled: true,
      __seq: 2,
    });
    const deleted = await service.deleteNiche(ORG_B, NICHE_B);
    expect(deleted.id).toBe(NICHE_B);
    expect(niches.rows.find((r) => r.id === NICHE_B)).toBeUndefined();
    expect(nicheTargets.rows.find((t) => t.nicheId === NICHE_B)).toBeUndefined();
    // The unrelated NICHE_A target is untouched.
    expect(nicheTargets.rows.find((t) => t.id === 't-a1')).toBeDefined();
  });

  it('deleteNiche 404s a cross-org niche (before the guard runs)', async () => {
    const { service } = seed();
    // NICHE_B belongs to ORG_B — ORG_A cannot delete it.
    await expect(service.deleteNiche(ORG_A, NICHE_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
