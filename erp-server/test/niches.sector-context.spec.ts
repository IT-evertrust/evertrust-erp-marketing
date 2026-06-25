import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { NichesService } from '../src/niches/niches.service';
import { getDb, seed as seedRows } from './real-db';

// resolveSectorContext powers the Reach outreach-template placeholders: {{TenderFocus}} <-
// niche name, {{IndustryFocus}} <- parent industry, {{Type}} <- first ENABLED target
// (alphabetical). These pin: industry resolves from the niche's parent; the target is the
// alphabetically-first ENABLED one (disabled excluded); a bare niche (no industry/targets)
// yields nulls (the free-text-niche fallback); cross-org access 404s.

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_ORG = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const IND_IT = 'c0000000-0000-0000-0000-000000000001';
const NICHE_FULL = 'd0000000-0000-0000-0000-000000000001'; // has industry + targets
const NICHE_BARE = 'd0000000-0000-0000-0000-000000000002'; // no industry, no targets
const T_OPERATOR = 'e0000000-0000-0000-0000-000000000001';
const T_PROVIDER = 'e0000000-0000-0000-0000-000000000002';
const T_DISABLED = 'e0000000-0000-0000-0000-000000000003';

async function seed() {
  await seedRows(schema.industries, [
    { id: IND_IT, organizationId: ORG, name: 'IT', slug: 'it' },
  ]);
  await seedRows(schema.niches, [
    { id: NICHE_FULL, organizationId: ORG, name: 'Cloud Infrastructure', slug: 'cloud-infrastructure', industryId: IND_IT },
    { id: NICHE_BARE, organizationId: ORG, name: 'Custom Sector', slug: 'custom-sector' },
  ]);
  await seedRows(schema.nicheTargets, [
    // Alphabetically: Operator < Provider < Zzz — Operator is the first enabled.
    { id: T_PROVIDER, nicheId: NICHE_FULL, name: 'Provider', slug: 'provider', searchHint: null, source: 'AI', enabled: true },
    { id: T_OPERATOR, nicheId: NICHE_FULL, name: 'Operator', slug: 'operator', searchHint: null, source: 'AI', enabled: true },
    { id: T_DISABLED, nicheId: NICHE_FULL, name: 'Aaa Disabled', slug: 'aaa-disabled', searchHint: null, source: 'AI', enabled: false },
  ]);
  return new NichesService(getDb());
}

describe('NichesService.resolveSectorContext', () => {
  it('derives niche name, parent industry, and the first ENABLED target (alphabetical)', async () => {
    const service = await seed();
    const ctx = await service.resolveSectorContext(ORG, NICHE_FULL);
    expect(ctx).toEqual({
      nicheName: 'Cloud Infrastructure',
      industryName: 'IT',
      targetName: 'Operator', // 'Aaa Disabled' is disabled → skipped; Operator < Provider
    });
  });

  it('returns null industry/target for a bare niche (the free-text-niche fallback)', async () => {
    const service = await seed();
    const ctx = await service.resolveSectorContext(ORG, NICHE_BARE);
    expect(ctx).toEqual({
      nicheName: 'Custom Sector',
      industryName: null,
      targetName: null,
    });
  });

  it('404s a niche owned by another org (no cross-tenant leak)', async () => {
    const service = await seed();
    await expect(service.resolveSectorContext(OTHER_ORG, NICHE_FULL)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
