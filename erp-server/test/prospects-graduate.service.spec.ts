import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ProspectsService } from '../src/prospects/prospects.service';
import { LeadsService } from '../src/leads/leads.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb, makeWorkflowConfig } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const config = { get: () => '' } as unknown as AppConfigService;

function seed(prospectRows: Record<string, unknown>[] = [], leadRows: Record<string, unknown>[] = []) {
  const campaigns = new FakeTable([
    {
      id: CAMP,
      organizationId: ORG_A,
      project: 'EverTrust DE',
      nicheId: 'niche-1',
      lifecycle: 'ACTIVE',
      __seq: 1,
    },
  ]);
  const prospects = new FakeTable(prospectRows);
  const leads = new FakeTable(leadRows);
  const niches = new FakeTable([]);
  const customers = new FakeTable([]);
  const suppressions = new FakeTable([]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.campaigns, campaigns],
      [schema.prospects, prospects],
      [schema.leads, leads],
      [schema.niches, niches],
      [schema.customers, customers],
      [schema.suppressions, suppressions],
      [schema.auditLog, auditLog],
    ]),
  );
  const leadsService = new LeadsService(db, config, new NichesService(db));
  const service = new ProspectsService(
    db,
    leadsService,
    makeWorkflowConfig(db, config),
  );
  return { service, prospects, leads };
}

const prospect = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
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
  __seq: 1,
  ...over,
});

describe('ProspectsService.graduate — INTERESTED → hot lead', () => {
  it('creates the hot lead, links it onto the prospect, and reports graduated=true', async () => {
    const { service, prospects, leads } = seed([prospect()]);

    const res = await service.graduate('p1', { hotReason: 'Asked for pricing' });

    expect(res.graduated).toBe(true);
    expect(leads.rows).toHaveLength(1);
    const lead = leads.rows[0]!;
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
    expect(prospects.rows[0]!.leadId).toBe(lead.id);
    expect(prospects.rows[0]!.status).toBe('INTERESTED');
    expect(res.lead.id).toBe(lead.id);
  });

  it('is idempotent: a second graduate returns the SAME lead, graduated=false, no duplicate', async () => {
    const { service, leads } = seed([prospect()]);

    const first = await service.graduate('p1', {});
    expect(first.graduated).toBe(true);

    const second = await service.graduate('p1', {});
    expect(second.graduated).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(leads.rows).toHaveLength(1); // no duplicate
  });

  it('links an existing (org,email) lead instead of duplicating it (graduated=false)', async () => {
    const existingLead = {
      id: 'lead-existing',
      organizationId: ORG_A,
      email: 'lead@co.com', // same email as the prospect
      companyName: 'Old Name',
      stage: 'MEETING_SCHEDULED',
      source: 'MANUAL',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
      __seq: 1,
    };
    const { service, prospects, leads } = seed([prospect()], [existingLead]);

    const res = await service.graduate('p1', {});

    expect(res.graduated).toBe(false);
    expect(res.lead.id).toBe('lead-existing');
    expect(leads.rows).toHaveLength(1); // the unique (org,email) key is respected
    // The prospect is linked to the pre-existing lead.
    expect(prospects.rows[0]!.leadId).toBe('lead-existing');
  });

  it('404s for an unknown prospect', async () => {
    const { service } = seed([]);
    await expect(service.graduate('nope', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
