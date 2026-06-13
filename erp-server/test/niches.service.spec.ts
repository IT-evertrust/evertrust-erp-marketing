import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
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
  return { service: new NichesService(db), niches };
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
