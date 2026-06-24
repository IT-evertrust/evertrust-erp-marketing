import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { ProspectsService } from '../src/prospects/prospects.service';
import { LeadsService } from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, rowsOf, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAMP_ARCHIVED = 'cccccccc-cccc-cccc-cccc-ccccccccdddd';
const LEAD_1 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// n8n env blank → any webhook-firing leads methods report not-configured (unused
// here; ProspectsService only calls LeadsService.graduateFromProspect).
const config = { get: () => '' } as unknown as AppConfigService;

// A campaigns row satisfying the NOT-NULL AIM columns. FK enforcement is off on the
// test connection, so a synthetic nicheId is fine.
function campaignRow(id: string, lifecycle: 'ACTIVE' | 'ARCHIVED') {
  return {
    id,
    organizationId: ORG_A,
    lifecycle,
    project: 'EverTrust DE',
    nicheId: '99990000-0000-0000-0000-000000000001',
    country: 'DE',
    region: 'Bayern',
    gmailLabel: 'label',
    whatsappNumber: '+490000',
  };
}

// Seed the two campaigns (one ACTIVE, one ARCHIVED) and return a service over the
// real db. Per-test extra rows (prospects/suppressions/orgConfig) are seeded inline.
async function makeService() {
  await seed(schema.campaigns, [
    campaignRow(CAMP, 'ACTIVE'),
    campaignRow(CAMP_ARCHIVED, 'ARCHIVED'),
  ]);
  const db = getDb();
  const leadsService = new LeadsService(db, config, new NichesService(db));
  return {
    service: new ProspectsService(db, leadsService),
  };
}

describe('ProspectsService — bulk upsert idempotency', () => {
  // WHY: Lead Satellite re-scrapes the same companies. A second POST must UPDATE
  // (not duplicate) and must NEVER regress conversation state (status/snooze/
  // followup/leadId) set by the outreach stages in between.
  it('inserts on first POST, updates on second; conversation state is preserved', async () => {
    const { service } = await makeService();

    const first = await service.bulkUpsert(CAMP, [
      { email: 'A@Co.com', companyName: 'Co', city: 'Berlin' },
    ]);
    expect(first).toEqual({ created: 1, updated: 0 });
    let rows = await rowsOf(schema.prospects);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('a@co.com'); // normalised

    // Outreach progressed this prospect between scrapes — persist that state in the
    // DB (the fake mutated the in-memory row; here we write it back).
    await getDb()
      .update(schema.prospects)
      .set({
        status: 'EMAILED',
        followupCount: 2,
        snoozeUntil: new Date('2026-07-01T00:00:00.000Z'),
        leadId: LEAD_1,
      })
      .where(eq(schema.prospects.id, rows[0]!.id));

    const second = await service.bulkUpsert(CAMP, [
      { email: 'a@co.com', companyName: 'Co GmbH', website: 'co.de' },
    ]);
    expect(second).toEqual({ created: 0, updated: 1 });
    rows = await rowsOf(schema.prospects);
    expect(rows).toHaveLength(1); // no duplicate

    const row = rows[0]!;
    // Scraped fields updated...
    expect(row.companyName).toBe('Co GmbH');
    expect(row.website).toBe('co.de');
    // ...conversation state intact (never regressed).
    expect(row.status).toBe('EMAILED');
    expect(row.followupCount).toBe(2);
    expect(row.snoozeUntil).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    expect(row.leadId).toBe(LEAD_1);
  });

  it('rejects a bulk write to an unknown campaign', async () => {
    const { service } = await makeService();
    await expect(
      service.bulkUpsert('00000000-0000-0000-0000-000000000000', [
        { email: 'x@y.com' },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a bulk write to an ARCHIVED campaign', async () => {
    const { service } = await makeService();
    await expect(
      service.bulkUpsert(CAMP_ARCHIVED, [{ email: 'x@y.com' }]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProspectsService — snooze filter', () => {
  // (The n8n sendList send-queue gate was retired with the n8n marketing flow.)
  it('snoozeDue includes only NOT_INTERESTED prospects whose snooze has elapsed', async () => {
    const { service } = await makeService();
    await seed(schema.prospects, [
      { id: 'a0000004-0000-0000-0000-000000000001', organizationId: ORG_A, campaignId: CAMP, email: 'due@co.com', status: 'NOT_INTERESTED', snoozeUntil: new Date('2020-01-01T00:00:00.000Z') },
      { id: 'a0000004-0000-0000-0000-000000000002', organizationId: ORG_A, campaignId: CAMP, email: 'future@co.com', status: 'NOT_INTERESTED', snoozeUntil: new Date('2999-01-01T00:00:00.000Z') },
    ]);
    const list = await service.list({ snoozeDue: true });
    expect(list.map((r) => r.email)).toEqual(['due@co.com']);
  });
});

describe('ProspectsService — partial update', () => {
  it('patches the supplied fields and 404s an unknown id', async () => {
    const { service } = await makeService();
    const [row] = await seed(schema.prospects, [
      { organizationId: ORG_A, campaignId: CAMP, email: 'p1@co.com', status: 'NEW', followupCount: 0 },
    ]);

    const updated = await service.update(row.id, {
      status: 'EMAILED',
      followupCount: 1,
    });
    expect(updated.status).toBe('EMAILED');
    expect(updated.followupCount).toBe(1);

    await expect(
      service.update('00000000-0000-0000-0000-000000000000', { status: 'NEW' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
