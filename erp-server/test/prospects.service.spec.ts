import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ProspectsService } from '../src/prospects/prospects.service';
import { LeadsService } from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAMP_ARCHIVED = 'cccccccc-cccc-cccc-cccc-ccccccccdddd';

// n8n env blank → any webhook-firing leads methods report not-configured (unused
// here; ProspectsService only calls LeadsService.graduateFromProspect).
const config = { get: () => '' } as unknown as AppConfigService;

function seed() {
  const campaigns = new FakeTable([
    { id: CAMP, organizationId: ORG_A, lifecycle: 'ACTIVE', __seq: 1 },
    { id: CAMP_ARCHIVED, organizationId: ORG_A, lifecycle: 'ARCHIVED', __seq: 2 },
  ]);
  const prospects = new FakeTable([]);
  const suppressions = new FakeTable([]);
  const leads = new FakeTable([]);
  const niches = new FakeTable([]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.campaigns, campaigns],
      [schema.prospects, prospects],
      [schema.suppressions, suppressions],
      [schema.leads, leads],
      [schema.niches, niches],
      [schema.auditLog, auditLog],
    ]),
  );
  const leadsService = new LeadsService(db, config, new NichesService(db));
  return {
    service: new ProspectsService(db, leadsService),
    prospects,
    suppressions,
  };
}

describe('ProspectsService — bulk upsert idempotency', () => {
  // WHY: Lead Satellite re-scrapes the same companies. A second POST must UPDATE
  // (not duplicate) and must NEVER regress conversation state (status/snooze/
  // followup/leadId) set by the outreach stages in between.
  it('inserts on first POST, updates on second; conversation state is preserved', async () => {
    const { service, prospects } = seed();

    const first = await service.bulkUpsert(CAMP, [
      { email: 'A@Co.com', companyName: 'Co', city: 'Berlin' },
    ]);
    expect(first).toEqual({ created: 1, updated: 0 });
    expect(prospects.rows).toHaveLength(1);
    expect(prospects.rows[0]!.email).toBe('a@co.com'); // normalised

    // Outreach progressed this prospect between scrapes.
    prospects.rows[0]!.status = 'EMAILED';
    prospects.rows[0]!.followupCount = 2;
    prospects.rows[0]!.snoozeUntil = new Date('2026-07-01T00:00:00.000Z');
    prospects.rows[0]!.leadId = 'lead-1';

    const second = await service.bulkUpsert(CAMP, [
      { email: 'a@co.com', companyName: 'Co GmbH', website: 'co.de' },
    ]);
    expect(second).toEqual({ created: 0, updated: 1 });
    expect(prospects.rows).toHaveLength(1); // no duplicate

    const row = prospects.rows[0]!;
    // Scraped fields updated...
    expect(row.companyName).toBe('Co GmbH');
    expect(row.website).toBe('co.de');
    // ...conversation state intact (never regressed).
    expect(row.status).toBe('EMAILED');
    expect(row.followupCount).toBe(2);
    expect(row.snoozeUntil).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    expect(row.leadId).toBe('lead-1');
  });

  it('rejects a bulk write to an unknown campaign', async () => {
    const { service } = seed();
    await expect(
      service.bulkUpsert('00000000-0000-0000-0000-000000000000', [
        { email: 'x@y.com' },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a bulk write to an ARCHIVED campaign', async () => {
    const { service } = seed();
    await expect(
      service.bulkUpsert(CAMP_ARCHIVED, [{ email: 'x@y.com' }]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProspectsService — send-list + snooze filters', () => {
  it('sendList includes only eligible prospects (active, NEW|EMAILED, <3 followups, not suppressed)', async () => {
    const { service, prospects, suppressions } = seed();
    const base = { organizationId: ORG_A, campaignId: CAMP, followupCount: 0 };
    prospects.rows.push(
      { ...base, id: 'p-new', email: 'new@co.com', status: 'NEW', __seq: 1 },
      // capped: 3 follow-ups already
      {
        ...base,
        id: 'p-capped',
        email: 'capped@co.com',
        status: 'EMAILED',
        followupCount: 3,
        __seq: 2,
      },
      // wrong status
      { ...base, id: 'p-replied', email: 'replied@co.com', status: 'REPLIED', __seq: 3 },
      // suppressed
      { ...base, id: 'p-supp', email: 'supp@co.com', status: 'NEW', __seq: 4 },
      // cooled down too recently
      {
        ...base,
        id: 'p-recent',
        email: 'recent@co.com',
        status: 'EMAILED',
        lastContactedAt: new Date(),
        __seq: 5,
      },
    );
    suppressions.rows.push({
      id: 's1',
      organizationId: ORG_A,
      email: 'supp@co.com',
      __seq: 1,
    });

    const list = await service.list({ sendList: true });
    expect(list.map((r) => r.id)).toEqual(['p-new']);
  });

  it('snoozeDue includes only NOT_INTERESTED prospects whose snooze has elapsed', async () => {
    const { service, prospects } = seed();
    prospects.rows.push(
      {
        id: 'p-due',
        organizationId: ORG_A,
        campaignId: CAMP,
        email: 'due@co.com',
        status: 'NOT_INTERESTED',
        snoozeUntil: new Date('2020-01-01T00:00:00.000Z'),
        __seq: 1,
      },
      {
        id: 'p-future',
        organizationId: ORG_A,
        campaignId: CAMP,
        email: 'future@co.com',
        status: 'NOT_INTERESTED',
        snoozeUntil: new Date('2999-01-01T00:00:00.000Z'),
        __seq: 2,
      },
    );
    const list = await service.list({ snoozeDue: true });
    expect(list.map((r) => r.id)).toEqual(['p-due']);
  });
});

describe('ProspectsService — partial update', () => {
  it('patches the supplied fields and 404s an unknown id', async () => {
    const { service, prospects } = seed();
    prospects.rows.push({
      id: 'p1',
      organizationId: ORG_A,
      campaignId: CAMP,
      email: 'p1@co.com',
      status: 'NEW',
      followupCount: 0,
      __seq: 1,
    });

    const updated = await service.update('p1', {
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
