import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ProspectsService } from '../src/prospects/prospects.service';
import { LeadsService } from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, makeWorkflowConfig, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PROSPECT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const EXISTING_LEAD = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const config = { get: () => '' } as unknown as AppConfigService;

// Seed the campaign the graduating prospect hangs off (project = the lead's
// sourceCampaign). FK enforcement is off, so a synthetic nicheId satisfies NOT NULL.
async function seedCampaign() {
  await seed(schema.campaigns, [
    {
      id: CAMP,
      organizationId: ORG_A,
      project: 'EverTrust DE',
      nicheId: '99990000-0000-0000-0000-000000000001',
      country: 'DE',
      region: 'Bayern',
      gmailLabel: 'label',
      whatsappNumber: '+490000',
      lifecycle: 'ACTIVE',
    },
  ]);
}

async function makeService(
  prospectRows: Record<string, unknown>[] = [],
  leadRows: Record<string, unknown>[] = [],
) {
  await seedCampaign();
  if (prospectRows.length) await seed(schema.prospects, prospectRows);
  if (leadRows.length) await seed(schema.leads, leadRows);
  const db = getDb();
  const leadsService = new LeadsService(db, config, new NichesService(db));
  const service = new ProspectsService(
    db,
    leadsService,
    makeWorkflowConfig(db, config),
  );
  return { service };
}

const prospect = (over: Record<string, unknown> = {}) => ({
  id: PROSPECT,
  organizationId: ORG_A,
  campaignId: CAMP,
  email: 'lead@co.com',
  companyName: 'Co GmbH',
  website: 'co.de',
  city: 'Berlin',
  country: 'DE',
  status: 'INTERESTED',
  followupCount: 1,
  leadId: null,
  ...over,
});

describe('ProspectsService.graduate — INTERESTED → hot lead', () => {
  it('creates the hot lead, links it onto the prospect, and reports graduated=true', async () => {
    const { service } = await makeService([prospect()]);

    const res = await service.graduate(PROSPECT, { hotReason: 'Asked for pricing' });

    expect(res.graduated).toBe(true);
    const leads = await getDb().select().from(schema.leads);
    expect(leads).toHaveLength(1);
    const lead = leads[0]!;
    expect(lead.email).toBe('lead@co.com');
    expect(lead.companyName).toBe('Co GmbH');
    expect(lead.source).toBe('N8N');
    expect(lead.stage).toBe('INTERESTED');
    expect(lead.hotReason).toBe('Asked for pricing');
    expect(lead.sourceCampaign).toBe('EverTrust DE'); // campaign.project
    expect(lead.campaignId).toBe(CAMP);
    // Campaign-sourced lead inherits its niche via the campaign → nicheId NULL.
    expect(lead.nicheId).toBeNull();
    // The prospect is linked + moved to INTERESTED.
    const prospects = await getDb().select().from(schema.prospects);
    expect(prospects[0]!.leadId).toBe(lead.id);
    expect(prospects[0]!.status).toBe('INTERESTED');
    expect(res.lead.id).toBe(lead.id);
  });

  it('is idempotent: a second graduate returns the SAME lead, graduated=false, no duplicate', async () => {
    const { service } = await makeService([prospect()]);

    const first = await service.graduate(PROSPECT, {});
    expect(first.graduated).toBe(true);

    const second = await service.graduate(PROSPECT, {});
    expect(second.graduated).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(await getDb().select().from(schema.leads)).toHaveLength(1); // no duplicate
  });

  it('links an existing (org,email) lead instead of duplicating it (graduated=false)', async () => {
    const existingLead = {
      id: EXISTING_LEAD,
      organizationId: ORG_A,
      email: 'lead@co.com', // same email as the prospect
      companyName: 'Old Name',
      stage: 'MEETING_SCHEDULED',
      source: 'MANUAL',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    };
    const { service } = await makeService([prospect()], [existingLead]);

    const res = await service.graduate(PROSPECT, {});

    expect(res.graduated).toBe(false);
    expect(res.lead.id).toBe(EXISTING_LEAD);
    expect(await getDb().select().from(schema.leads)).toHaveLength(1); // unique (org,email) respected
    // The prospect is linked to the pre-existing lead.
    const prospects = await getDb().select().from(schema.prospects);
    expect(prospects[0]!.leadId).toBe(EXISTING_LEAD);
  });

  it('404s for an unknown prospect', async () => {
    const { service } = await makeService([]);
    await expect(
      service.graduate('11111111-1111-1111-1111-111111111111', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
