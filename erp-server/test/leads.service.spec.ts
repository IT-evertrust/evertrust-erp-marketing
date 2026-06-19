import { ConflictException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import {
  LeadsService,
  extractLeadRows,
  stageForRow,
} from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, rowsOf, seed as seedRows } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const C_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const NICHE_C = 'cccccccc-1111-1111-1111-cccccccccccc';

// n8n env blank → backfill/provision/run-pipeline report not-configured.
const config = { get: () => '' } as unknown as AppConfigService;

async function seed() {
  // One campaign for the org. The fake only set project/driveFolderId; the real
  // campaigns table has NOT-NULL columns with no default (nicheId/country/region/
  // gmailLabel/whatsappNumber) that must be satisfied. FK is off, so nicheId need
  // not point at a real niche.
  await seedRows(schema.campaigns, [
    {
      id: C_A,
      organizationId: ORG_A,
      project: 'P1',
      driveFolderId: 'F1',
      nicheId: NICHE_C,
      country: 'DE',
      region: 'Berlin',
      gmailLabel: 'P1',
      whatsappNumber: '+490000000',
    },
  ]);
  const db = getDb();
  // LeadsService resolves free-text niche → nicheId via NichesService (find-or-create).
  const nichesService = new NichesService(db);
  return {
    service: new LeadsService(db, config, nichesService),
  };
}

describe('extractLeadRows / stageForRow (n8n hot_leads mapping)', () => {
  const runData = {
    'Compute Intake + Graduate': [
      {
        data: {
          main: [
            [
              {
                json: {
                  _t: 'hot',
                  'Company Name': 'Acme',
                  Email: 'Hot@Acme.com',
                  Tier: 'AAA',
                  Niche: 'Cloud',
                  'Source Campaign': 'P1',
                  'Hot Reason': 'Interested',
                  'Detected At': '2026-06-02T09:00:00.000Z',
                },
              },
              {
                json: {
                  _t: 'cust',
                  'Company Name': 'Beta',
                  Email: 'won@beta.com',
                  'Hot Reason': 'MeetingScheduled',
                },
              },
            ],
          ],
        },
      },
    ],
  };

  it('extracts hot + cust rows and lowercases email', () => {
    const rows = extractLeadRows(runData);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      t: 'hot',
      email: 'hot@acme.com',
      companyName: 'Acme',
      tier: 'AAA',
      sourceCampaign: 'P1',
      hotReason: 'Interested',
    });
    expect(rows[1]).toMatchObject({ t: 'cust', email: 'won@beta.com' });
  });

  it('maps stage from row type / hot reason', () => {
    expect(stageForRow({ t: 'hot', hotReason: 'Interested' } as never)).toBe(
      'INTERESTED',
    );
    expect(
      stageForRow({ t: 'hot', hotReason: 'MeetingScheduled' } as never),
    ).toBe('MEETING_SCHEDULED');
    expect(stageForRow({ t: 'cust' } as never)).toBe('CUSTOMER');
  });

  it('tolerates a missing node → []', () => {
    expect(extractLeadRows({})).toEqual([]);
  });
});

describe('LeadsService — manual CRUD + convert', () => {
  it('creates a manual lead (INTERESTED, source MANUAL) and rejects a dup email', async () => {
    const { service } = await seed();
    const lead = await service.create(ORG_A, USER, {
      email: 'New@Lead.com',
      companyName: 'NewCo',
      niche: 'LED',
    });
    expect(lead.email).toBe('new@lead.com'); // normalised
    expect(lead.stage).toBe('INTERESTED');
    expect(lead.source).toBe('MANUAL');

    await expect(
      service.create(ORG_A, USER, { email: 'new@lead.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('filters list by stage', async () => {
    const { service } = await seed();
    await service.create(ORG_A, USER, { email: 'a@x.com' });
    await service.create(ORG_A, USER, {
      email: 'b@x.com',
      stage: 'MEETING_SCHEDULED',
    });
    const interested = await service.list(ORG_A, { stage: 'INTERESTED' });
    expect(interested.map((l) => l.email)).toEqual(['a@x.com']);
  });

  it('converts a lead → creates + links an ERP customer, then 409 on re-convert', async () => {
    const { service } = await seed();
    const lead = await service.create(ORG_A, USER, {
      email: 'win@deal.com',
      companyName: 'DealCo',
      niche: 'Solar',
    });
    const converted = await service.convert(ORG_A, lead.id);
    expect(converted.stage).toBe('CUSTOMER');
    expect(converted.customerId).toBeTruthy();
    const customerRows = await rowsOf(schema.customers);
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0]).toMatchObject({
      name: 'DealCo',
      contact: 'win@deal.com',
      niches: ['Solar'],
    });

    await expect(service.convert(ORG_A, lead.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('LeadsService — clearLeads (test-data reset)', () => {
  it('deletes all org leads and returns the count', async () => {
    const { service } = await seed();
    await service.create(ORG_A, USER, { email: 'a@x.com' });
    await service.create(ORG_A, USER, { email: 'b@x.com' });
    expect(await service.clearLeads(ORG_A)).toBe(2);
    expect(await service.list(ORG_A)).toHaveLength(0);
  });
});

describe('LeadsService — backfill/provision gating', () => {
  it('reports not-configured when the n8n API is blank', async () => {
    const { service } = await seed();
    expect(await service.backfill(ORG_A)).toEqual({
      configured: false,
      scanned: 0,
      imported: 0,
      customers: 0,
    });
    const prov = await service.provision(ORG_A, C_A);
    expect(prov.configured).toBe(false);
    const run = await service.runPipeline(ORG_A);
    expect(run.configured).toBe(false);
  });
});
