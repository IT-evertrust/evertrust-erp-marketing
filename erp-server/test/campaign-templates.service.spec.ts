import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import type { CreateCampaignDto } from '@evertrust/shared';
import { CampaignTemplatesService } from '../src/campaigns/campaign-templates.service';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb, makeWorkflowConfig } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const DTO: CreateCampaignDto = {
  nicheName: 'LED',
  country: 'Germany',
  region: 'North',
  project: 'LED Retrofit Berlin 2026',
  gmailLabel: 'LED-Berlin-2026',
  salesCalendarId: 'info@evertrust-germany.de',
  whatsappNumber: '+4915112345678',
  sender: 'info',
};

// No AIM webhook → create() saves the campaign as DRAFT without any fetch.
function makeConfig(): AppConfigService {
  return { get: () => '' } as unknown as AppConfigService;
}

// Seed campaigns + niches + nicheTargets (so CampaignsService.getConfig works) and
// auditLog (CampaignTemplatesService.merge writes a machine audit row). Both
// services share the SAME fake db so a merge is visible to a subsequent getConfig.
function seed() {
  const campaigns = new FakeTable([]);
  const niches = new FakeTable([]);
  const nicheTargets = new FakeTable([]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.campaigns, campaigns],
      [schema.niches, niches],
      [schema.nicheTargets, nicheTargets],
      [schema.auditLog, auditLog],
    ]),
  );
  const nichesService = new NichesService(db);
  return {
    templates: new CampaignTemplatesService(db),
    campaignsService: new CampaignsService(
      db,
      makeWorkflowConfig(db, makeConfig()),
      nichesService,
    ),
    campaigns,
    auditLog,
  };
}

describe('CampaignTemplatesService — incremental merge', () => {
  // WHY: Ammo Forge sets blocks across multiple POSTs (one stage writes coldEmail,
  // a later stage writes slotProposal). Distinct keys must accumulate — the second
  // POST must NOT clobber the first.
  it('merges distinct keys across two POSTs (both blocks survive)', async () => {
    const { templates, campaignsService, campaigns } = seed();
    const { campaign } = await campaignsService.create(ORG_A, DTO, USER);

    const first = await templates.merge(campaign.id, {
      coldEmail: 'Hello {{firstName}}',
    });
    expect(first).toEqual({ coldEmail: 'Hello {{firstName}}' });

    const second = await templates.merge(campaign.id, {
      slotProposal: 'Are you free {{slot}}?',
    });
    // Both keys present after the second (incremental) POST.
    expect(second).toEqual({
      coldEmail: 'Hello {{firstName}}',
      slotProposal: 'Are you free {{slot}}?',
    });
    // Persisted on the campaign row.
    expect(campaigns.rows[0]!.templates).toEqual({
      coldEmail: 'Hello {{firstName}}',
      slotProposal: 'Are you free {{slot}}?',
    });
  });

  // WHY: re-sending a block with the same key is a deliberate update (regenerated
  // copy), so that key — and only that key — is overwritten.
  it('overwrites an existing key when the same key is re-sent', async () => {
    const { templates, campaignsService } = seed();
    const { campaign } = await campaignsService.create(ORG_A, DTO, USER);

    await templates.merge(campaign.id, { coldEmail: 'v1', newsBrief: 'brief' });
    const merged = await templates.merge(campaign.id, { coldEmail: 'v2' });

    expect(merged).toEqual({ coldEmail: 'v2', newsBrief: 'brief' });
  });

  // WHY: the merged blocks must be visible to the machine config the workflows
  // fetch (GET /campaigns/:id/config) — that is the whole point of the contract.
  it('exposes the merged templates on the machine config', async () => {
    const { templates, campaignsService } = seed();
    const { campaign } = await campaignsService.create(ORG_A, DTO, USER);

    await templates.merge(campaign.id, { coldEmail: 'hi', meetingConfirmation: 'see you' });

    const cfg = await campaignsService.getConfig(campaign.id);
    expect(cfg.templates).toEqual({
      coldEmail: 'hi',
      meetingConfirmation: 'see you',
    });
  });

  // WHY: config defaults templates to {} so a machine caller never gets null —
  // a campaign that never received a block still returns an empty map.
  it('config returns {} when no templates were ever set', async () => {
    const { campaignsService } = seed();
    const { campaign } = await campaignsService.create(ORG_A, DTO, USER);

    const cfg = await campaignsService.getConfig(campaign.id);
    expect(cfg.templates).toEqual({});
  });

  it('404s merging templates into an unknown campaign', async () => {
    const { templates } = seed();
    await expect(
      templates.merge('00000000-0000-0000-0000-000000000000', { coldEmail: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
