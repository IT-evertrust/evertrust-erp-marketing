import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ProspectsService } from '../src/prospects/prospects.service';
import { LeadsService } from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAMP_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAMP_B = 'cccccccc-cccc-cccc-cccc-ccccccccdddd';

const PA1 = 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PA2 = 'aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PA3 = 'aaaa0003-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PB1 = 'bbbb0001-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const NT1 = '77770001-0000-0000-0000-000000000000';
const NT2 = '77770002-0000-0000-0000-000000000000';

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
    { id: PA1, organizationId: ORG_A, campaignId: CAMP_A, email: 'alpha@aco.com', companyName: 'Alpha GmbH', status: 'NEW', followupCount: 0, nicheTargetId: NT1, createdAt: new Date('2026-01-01T00:00:00Z') },
    { id: PA2, organizationId: ORG_A, campaignId: CAMP_A, email: 'beta@aco.com', companyName: 'Beta AG', status: 'EMAILED', followupCount: 1, nicheTargetId: NT2, createdAt: new Date('2026-02-01T00:00:00Z') },
    { id: PA3, organizationId: ORG_A, campaignId: CAMP_A, email: 'gamma@aco.com', companyName: null, status: 'NEW', followupCount: 0, nicheTargetId: NT1, createdAt: new Date('2026-03-01T00:00:00Z') },
    { id: PB1, organizationId: ORG_B, campaignId: CAMP_B, email: 'alpha@bco.com', companyName: 'Other', status: 'NEW', followupCount: 0 },
  ]);
  const db = getDb();
  const leadsService = new LeadsService(db, config, new NichesService(db));
  return {
    service: new ProspectsService(db, leadsService),
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

describe('ProspectsService.boardList — pipeline stage + scope filters', () => {
  it('returns stageCounts + each row carries its pipelineStage (defaults INTEREST)', async () => {
    const { service } = await makeService();
    const res = await service.boardList(ORG_A, {});
    // Seeded rows have no explicit stage → the column default INTEREST.
    expect(res.stageCounts).toEqual({ INTEREST: 3 });
    expect(res.items.every((r) => r.pipelineStage === 'INTEREST')).toBe(true);
  });

  it('nicheTargetId is a SCOPE filter — narrows items AND the tallies', async () => {
    const { service } = await makeService();
    const res = await service.boardList(ORG_A, { nicheTargetId: NT1 });
    expect(res.items.map((r) => r.id).sort()).toEqual([PA1, PA3].sort());
    expect(res.total).toBe(2);
    expect(res.stageCounts).toEqual({ INTEREST: 2 }); // scope tally, not the full org
  });

  it('createdFrom/createdTo bound the set by creation date', async () => {
    const { service } = await makeService();
    const recent = await service.boardList(ORG_A, {
      createdFrom: new Date('2026-02-15T00:00:00Z'),
    });
    expect(recent.items.map((r) => r.id)).toEqual([PA3]); // only the 2026-03-01 row
    const middle = await service.boardList(ORG_A, {
      createdFrom: new Date('2026-01-15T00:00:00Z'),
      createdTo: new Date('2026-02-15T00:00:00Z'),
    });
    expect(middle.items.map((r) => r.id)).toEqual([PA2]); // only the 2026-02-01 row
  });
});

describe('ProspectsService.boardList — engagedOnly (Nurture pipeline)', () => {
  const PENG = 'aaaa0009-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('shows ONLY engaged prospects (replied+); hides cold NEW/EMAILED leads', async () => {
    const { service } = await makeService(); // PA1 NEW, PA2 EMAILED, PA3 NEW (all cold)
    await seed(schema.prospects, [
      {
        id: PENG,
        organizationId: ORG_A,
        campaignId: CAMP_A,
        email: 'engaged@aco.com',
        companyName: 'Engaged Co',
        status: 'INTERESTED',
        followupCount: 0,
      },
    ]);

    const res = await service.boardList(ORG_A, { engagedOnly: true });
    // Only the INTERESTED prospect — the 3 cold (NEW/EMAILED) leads stay out.
    expect(res.items.map((r) => r.id)).toEqual([PENG]);
    expect(res.total).toBe(1);
    // tallies are restricted to the engaged set too (so columns match the cards).
    expect(res.statusCounts).toEqual({ INTERESTED: 1 });
    expect(res.stageCounts).toEqual({ INTEREST: 1 });
  });

  it('without engagedOnly the same board still shows the cold leads (Engage view)', async () => {
    const { service } = await makeService();
    const res = await service.boardList(ORG_A, {});
    expect(res.total).toBe(3); // the 3 cold leads are visible to Engage
  });
});

describe('ProspectsService.updateStageForOrg', () => {
  it('moves a card in-org, leaves the outreach status untouched, 404s cross-org', async () => {
    const { service } = await makeService();
    const moved = await service.updateStageForOrg(ORG_A, PA1, 'WON');
    expect(moved.pipelineStage).toBe('WON');
    expect(moved.status).toBe('NEW'); // stage move never touches the agent-driven status

    const res = await service.boardList(ORG_A, {});
    expect(res.stageCounts).toEqual({ INTEREST: 2, WON: 1 });

    // ORG_A cannot move ORG_B's card.
    await expect(
      service.updateStageForOrg(ORG_A, PB1, 'LOST'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const after = await getDb().select().from(schema.prospects);
    expect(after.find((r) => r.id === PB1)!.pipelineStage).toBe('INTEREST');
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
