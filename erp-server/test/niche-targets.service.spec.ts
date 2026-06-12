import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { NichesService } from '../src/niches/niches.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NICHE_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const NICHE_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// niche_targets carry NO organizationId — tenancy is via the parent niche. The fake
// seeds a niche per org so the cross-org assertions exercise the real niche lookup.
function seed() {
  const niches = new FakeTable([
    { id: NICHE_A, organizationId: ORG_A, name: 'Cloud', slug: 'cloud', __seq: 1 },
    { id: NICHE_B, organizationId: ORG_B, name: 'Logistics', slug: 'logistics', __seq: 2 },
  ]);
  const nicheTargets = new FakeTable([
    { id: 't-a1', nicheId: NICHE_A, name: 'Provider', slug: 'provider', searchHint: null, source: 'AI', enabled: true, __seq: 1 },
    { id: 't-b1', nicheId: NICHE_B, name: 'Carrier', slug: 'carrier', searchHint: null, source: 'AI', enabled: true, __seq: 2 },
  ]);
  const campaigns = new FakeTable([
    { id: 'camp-a', organizationId: ORG_A, nicheId: NICHE_A, __seq: 1 },
  ]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.niches, niches],
      [schema.nicheTargets, nicheTargets],
      [schema.campaigns, campaigns],
    ]),
  );
  return { service: new NichesService(db), nicheTargets };
}

describe('NichesService — niche-target management (org-scoped)', () => {
  it('disables then re-enables a target via PATCH', async () => {
    const { service, nicheTargets } = seed();

    const disabled = await service.updateTargetForOrg(ORG_A, 't-a1', {
      enabled: false,
    });
    expect(disabled.target.enabled).toBe(false);
    expect(nicheTargets.rows.find((r) => r.id === 't-a1')!.enabled).toBe(false);

    const reenabled = await service.updateTargetForOrg(ORG_A, 't-a1', {
      enabled: true,
    });
    expect(reenabled.target.enabled).toBe(true);
  });

  it('renames a target and re-derives the slug', async () => {
    const { service } = seed();
    const res = await service.updateTargetForOrg(ORG_A, 't-a1', {
      name: 'Managed Service Provider',
    });
    expect(res.target.name).toBe('Managed Service Provider');
    expect(res.target.slug).toBe('managed-service-provider');
  });

  it('404s a PATCH on a target whose niche is in another org (no cross-org edit)', async () => {
    const { service, nicheTargets } = seed();
    // t-b1's niche (NICHE_B) belongs to ORG_B — ORG_A must not edit it.
    await expect(
      service.updateTargetForOrg(ORG_A, 't-b1', { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // ...and t-b1 is unchanged.
    expect(nicheTargets.rows.find((r) => r.id === 't-b1')!.enabled).toBe(true);
  });

  it('deletes a target in-org and 404s cross-org', async () => {
    const { service, nicheTargets } = seed();
    const res = await service.deleteTargetForOrg(ORG_A, 't-a1');
    expect(res.deleted).toBe(true);
    expect(nicheTargets.rows.find((r) => r.id === 't-a1')).toBeUndefined();

    await expect(
      service.deleteTargetForOrg(ORG_A, 't-b1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(nicheTargets.rows.find((r) => r.id === 't-b1')).toBeDefined();
  });

  it('adds a MANUAL target (org-scoped) and upserts a duplicate slug', async () => {
    const { service, nicheTargets } = seed();
    const added = await service.addManualTarget(ORG_A, NICHE_A, {
      name: 'Installer',
      searchHint: 'on-site',
    });
    expect(added.source).toBe('MANUAL');
    expect(added.name).toBe('Installer');
    expect(nicheTargets.rows.filter((r) => r.nicheId === NICHE_A)).toHaveLength(2);

    // Same slug → updates searchHint, no duplicate row.
    const again = await service.addManualTarget(ORG_A, NICHE_A, {
      name: 'Installer',
      searchHint: 'updated',
    });
    expect(again.id).toBe(added.id);
    expect(nicheTargets.rows.filter((r) => r.nicheId === NICHE_A)).toHaveLength(2);

    // Cross-org niche → 404.
    await expect(
      service.addManualTarget(ORG_A, NICHE_B, { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('targetsForOrg returns enabled AND disabled, and 404s a cross-org niche', async () => {
    const { service } = seed();
    await service.updateTargetForOrg(ORG_A, 't-a1', { enabled: false });
    const targets = await service.targetsForOrg(ORG_A, NICHE_A);
    // The disabled target is still listed (management view shows all).
    expect(targets.map((t) => t.id)).toContain('t-a1');

    await expect(
      service.targetsForOrg(ORG_A, NICHE_B),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listWithCounts reports per-niche target + campaign counts, org-scoped', async () => {
    const { service } = seed();
    const list = await service.listWithCounts(ORG_A);
    // ORG_A has only NICHE_A.
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(NICHE_A);
    expect(list[0]!.targetCount).toBe(1); // t-a1
    expect(list[0]!.campaignCount).toBe(1); // camp-a
  });
});
