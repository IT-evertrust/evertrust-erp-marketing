import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ProspectsService } from '../src/prospects/prospects.service';
import { LeadsService } from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb, makeWorkflowConfig } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAMP_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAMP_B = 'cccccccc-cccc-cccc-cccc-ccccccccdddd';

const config = { get: () => '' } as unknown as AppConfigService;

// Seed two orgs' prospects so the org-scoping assertions are meaningful (a cross-org
// read must genuinely return no rows — the fake-db matches organization_id for real).
function seed() {
  const campaigns = new FakeTable([
    { id: CAMP_A, organizationId: ORG_A, lifecycle: 'ACTIVE', name: 'Camp A', project: 'A', __seq: 1 },
    { id: CAMP_B, organizationId: ORG_B, lifecycle: 'ACTIVE', name: 'Camp B', project: 'B', __seq: 2 },
  ]);
  const prospects = new FakeTable([
    { id: 'pa1', organizationId: ORG_A, campaignId: CAMP_A, email: 'alpha@aco.com', companyName: 'Alpha GmbH', status: 'NEW', followupCount: 0, __seq: 1 },
    { id: 'pa2', organizationId: ORG_A, campaignId: CAMP_A, email: 'beta@aco.com', companyName: 'Beta AG', status: 'EMAILED', followupCount: 1, __seq: 2 },
    { id: 'pa3', organizationId: ORG_A, campaignId: CAMP_A, email: 'gamma@aco.com', companyName: null, status: 'NEW', followupCount: 0, __seq: 3 },
    { id: 'pb1', organizationId: ORG_B, campaignId: CAMP_B, email: 'alpha@bco.com', companyName: 'Other', status: 'NEW', followupCount: 0, __seq: 4 },
  ]);
  const suppressions = new FakeTable([]);
  const leads = new FakeTable([]);
  const niches = new FakeTable([]);
  const nicheTargets = new FakeTable([]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.campaigns, campaigns],
      [schema.prospects, prospects],
      [schema.suppressions, suppressions],
      [schema.leads, leads],
      [schema.niches, niches],
      [schema.nicheTargets, nicheTargets],
      [schema.auditLog, auditLog],
    ]),
  );
  const leadsService = new LeadsService(db, config, new NichesService(db));
  return {
    service: new ProspectsService(
      db,
      leadsService,
      makeWorkflowConfig(db, config),
    ),
    prospects,
  };
}

describe('ProspectsService.boardList — org scoping', () => {
  it('returns only the caller-org rows (never another org), with total + statusCounts', async () => {
    const { service } = seed();
    const res = await service.boardList(ORG_A, {});
    // ORG_B's prospect (pb1) must NEVER appear.
    expect(res.items.map((r) => r.id).sort()).toEqual(['pa1', 'pa2', 'pa3']);
    expect(res.total).toBe(3);
    // statusCounts is the full org tally (2 NEW, 1 EMAILED).
    expect(res.statusCounts).toEqual({ NEW: 2, EMAILED: 1 });
  });

  it('the other org sees only its own row', async () => {
    const { service } = seed();
    const res = await service.boardList(ORG_B, {});
    expect(res.items.map((r) => r.id)).toEqual(['pb1']);
    expect(res.total).toBe(1);
    expect(res.statusCounts).toEqual({ NEW: 1 });
  });

  it('filters by status for the page but keeps statusCounts over the whole org set', async () => {
    const { service } = seed();
    const res = await service.boardList(ORG_A, { status: 'EMAILED' });
    expect(res.items.map((r) => r.id)).toEqual(['pa2']);
    expect(res.total).toBe(1); // post-filter
    // statusCounts is independent of the status filter (full board columns).
    expect(res.statusCounts).toEqual({ NEW: 2, EMAILED: 1 });
  });

  it('q matches email OR companyName, case-insensitively', async () => {
    const { service } = seed();
    const byCompany = await service.boardList(ORG_A, { q: 'beta' }); // companyName "Beta AG"
    expect(byCompany.items.map((r) => r.id)).toEqual(['pa2']);
    const byEmail = await service.boardList(ORG_A, { q: 'GAMMA' }); // email gamma@aco.com
    expect(byEmail.items.map((r) => r.id)).toEqual(['pa3']);
  });

  it('paginates with limit + offset (total is the full filtered count)', async () => {
    const { service } = seed();
    const page1 = await service.boardList(ORG_A, { limit: 2, offset: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    const page2 = await service.boardList(ORG_A, { limit: 2, offset: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(3);
  });
});

describe('ProspectsService — org-scoped detail + status override', () => {
  it('getForOrg returns the row for its org and 404s a cross-org id', async () => {
    const { service } = seed();
    const row = await service.getForOrg(ORG_A, 'pa1');
    expect(row.id).toBe('pa1');
    // pb1 belongs to ORG_B — ORG_A must not be able to read it.
    await expect(service.getForOrg(ORG_A, 'pb1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updateStatusForOrg patches status in-org and 404s cross-org', async () => {
    const { service, prospects } = seed();
    const updated = await service.updateStatusForOrg(ORG_A, 'pa1', {
      status: 'DO_NOT_CONTACT',
    });
    expect(updated.status).toBe('DO_NOT_CONTACT');
    expect(prospects.rows.find((r) => r.id === 'pa1')!.status).toBe(
      'DO_NOT_CONTACT',
    );

    // ORG_A cannot touch ORG_B's prospect.
    await expect(
      service.updateStatusForOrg(ORG_A, 'pb1', { status: 'DO_NOT_CONTACT' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // ...and pb1 is unchanged.
    expect(prospects.rows.find((r) => r.id === 'pb1')!.status).toBe('NEW');
  });
});
