import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ProspectsService } from '../src/prospects/prospects.service';
import { LeadsService } from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, makeWorkflowConfig, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAMP_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAMP_B = 'cccccccc-cccc-cccc-cccc-ccccccccdddd';

const PA1 = 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PA2 = 'aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PA3 = 'aaaa0003-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PB1 = 'bbbb0001-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const config = { get: () => '' } as unknown as AppConfigService;

// A campaigns row satisfying the NOT-NULL AIM columns (nicheId/country/region/
// project/gmailLabel/whatsappNumber). FK enforcement is off on the test conn, so a
// synthetic nicheId is fine.
function campaignRow(id: string, orgId: string, name: string, project: string) {
  return {
    id,
    organizationId: orgId,
    name,
    project,
    lifecycle: 'ACTIVE' as const,
    nicheId: '99990000-0000-0000-0000-000000000001',
    country: 'DE',
    region: 'Bayern',
    gmailLabel: 'label',
    whatsappNumber: '+490000',
  };
}

// Seed two orgs' prospects so the org-scoping assertions are meaningful (a cross-org
// read must genuinely return no rows — the DB matches organization_id for real).
async function makeService() {
  await seed(schema.campaigns, [
    campaignRow(CAMP_A, ORG_A, 'Camp A', 'A'),
    campaignRow(CAMP_B, ORG_B, 'Camp B', 'B'),
  ]);
  await seed(schema.prospects, [
    { id: PA1, organizationId: ORG_A, campaignId: CAMP_A, email: 'alpha@aco.com', companyName: 'Alpha GmbH', status: 'NEW', followupCount: 0 },
    { id: PA2, organizationId: ORG_A, campaignId: CAMP_A, email: 'beta@aco.com', companyName: 'Beta AG', status: 'EMAILED', followupCount: 1 },
    { id: PA3, organizationId: ORG_A, campaignId: CAMP_A, email: 'gamma@aco.com', companyName: null, status: 'NEW', followupCount: 0 },
    { id: PB1, organizationId: ORG_B, campaignId: CAMP_B, email: 'alpha@bco.com', companyName: 'Other', status: 'NEW', followupCount: 0 },
  ]);
  const db = getDb();
  const leadsService = new LeadsService(db, config, new NichesService(db));
  return {
    service: new ProspectsService(db, leadsService, makeWorkflowConfig(db, config)),
  };
}

describe('ProspectsService.boardList — org scoping', () => {
  it('returns only the caller-org rows (never another org), with total + statusCounts', async () => {
    const { service } = await makeService();
    const res = await service.boardList(ORG_A, {});
    // ORG_B's prospect (pb1) must NEVER appear.
    expect(res.items.map((r) => r.id).sort()).toEqual([PA1, PA2, PA3].sort());
    expect(res.total).toBe(3);
    // statusCounts is the full org tally (2 NEW, 1 EMAILED).
    expect(res.statusCounts).toEqual({ NEW: 2, EMAILED: 1 });
  });

  it('the other org sees only its own row', async () => {
    const { service } = await makeService();
    const res = await service.boardList(ORG_B, {});
    expect(res.items.map((r) => r.id)).toEqual([PB1]);
    expect(res.total).toBe(1);
    expect(res.statusCounts).toEqual({ NEW: 1 });
  });

  it('filters by status for the page but keeps statusCounts over the whole org set', async () => {
    const { service } = await makeService();
    const res = await service.boardList(ORG_A, { status: 'EMAILED' });
    expect(res.items.map((r) => r.id)).toEqual([PA2]);
    expect(res.total).toBe(1); // post-filter
    // statusCounts is independent of the status filter (full board columns).
    expect(res.statusCounts).toEqual({ NEW: 2, EMAILED: 1 });
  });

  it('q matches email OR companyName, case-insensitively', async () => {
    const { service } = await makeService();
    const byCompany = await service.boardList(ORG_A, { q: 'beta' }); // companyName "Beta AG"
    expect(byCompany.items.map((r) => r.id)).toEqual([PA2]);
    const byEmail = await service.boardList(ORG_A, { q: 'GAMMA' }); // email gamma@aco.com
    expect(byEmail.items.map((r) => r.id)).toEqual([PA3]);
  });

  it('paginates with limit + offset (total is the full filtered count)', async () => {
    const { service } = await makeService();
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
    const { service } = await makeService();
    const row = await service.getForOrg(ORG_A, PA1);
    expect(row.id).toBe(PA1);
    // pb1 belongs to ORG_B — ORG_A must not be able to read it.
    await expect(service.getForOrg(ORG_A, PB1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updateStatusForOrg patches status in-org and 404s cross-org', async () => {
    const { service } = await makeService();
    const updated = await service.updateStatusForOrg(ORG_A, PA1, {
      status: 'DO_NOT_CONTACT',
    });
    expect(updated.status).toBe('DO_NOT_CONTACT');
    const rows = await getDb().select().from(schema.prospects);
    expect(rows.find((r) => r.id === PA1)!.status).toBe('DO_NOT_CONTACT');

    // ORG_A cannot touch ORG_B's prospect.
    await expect(
      service.updateStatusForOrg(ORG_A, PB1, { status: 'DO_NOT_CONTACT' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // ...and pb1 is unchanged.
    const after = await getDb().select().from(schema.prospects);
    expect(after.find((r) => r.id === PB1)!.status).toBe('NEW');
  });
});
