import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { schema } from '@evertrust/db';
import type { CreateCampaignDto } from '@evertrust/shared';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb, makeWorkflowConfig } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const WEBHOOK = 'https://evertrustgmbh.app.n8n.cloud/webhook/aim-deploy-campaign';

// The new create body: nicheName (find-or-created) + region (the zone enum). status/
// driveFolder*/activated* are server-owned and deliberately absent.
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

// Minimal AppConfigService stub — the service reads N8N_AIM_WEBHOOK_URL (deploy) and
// N8N_API_URL (the campaign-files webhook base).
function makeConfig(aimUrl = ''): AppConfigService {
  const values: Record<string, string> = { N8N_AIM_WEBHOOK_URL: aimUrl };
  return { get: (k: string) => values[k] ?? '' } as unknown as AppConfigService;
}

function seed(webhookUrl = '') {
  const campaigns = new FakeTable([]);
  const arsenalRuns = new FakeTable([]);
  const niches = new FakeTable([]);
  const nicheTargets = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.campaigns, campaigns],
      [schema.arsenalRuns, arsenalRuns],
      [schema.niches, niches],
      [schema.nicheTargets, nicheTargets],
    ]),
  );
  const nichesService = new NichesService(db);
  return {
    service: new CampaignsService(
      db,
      makeWorkflowConfig(db, makeConfig(webhookUrl)),
      nichesService,
    ),
    nichesService,
    campaigns,
    arsenalRuns,
    niches,
    nicheTargets,
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CampaignsService — launch (create + AIM deploy)', () => {
  // WHY: ERP-first. The campaign persists regardless of the webhook outcome; a 2xx
  // turns the saved target into a live (ACTIVE) campaign with activatedBy/At stamped.
  it('persists DRAFT, fires AIM, and flips to ACTIVE on a 2xx', async () => {
    const { service, niches } = seed(WEBHOOK);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { campaign, deployError } = await service.create(ORG_A, DTO, USER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(opts.method).toBe('POST');
    const sent = JSON.parse(opts.body as string);
    // The resolved niche NAME (not id) + region zone are sent; source tags it ERP.
    expect(sent).toMatchObject({
      niche: 'LED',
      region: 'North',
      country: 'Germany',
      sender: 'info',
      source: 'erp',
    });

    expect(deployError).toBeNull();
    expect(campaign.lifecycle).toBe('ACTIVE');
    expect(campaign.activatedBy).toBe(USER);
    expect(campaign.activatedAt).toBeInstanceOf(Date);
    // The niche was find-or-created and linked.
    expect(niches.rows).toHaveLength(1);
    expect(campaign.nicheId).toBe(niches.rows[0]!.id);
  });

  // WHY: a second campaign in the same niche must REUSE the niche row (find-or-create
  // is the dedup), not create a duplicate.
  it('reuses an existing niche across campaigns (find-or-create by slug)', async () => {
    const { service, niches } = seed(WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const a = await service.create(ORG_A, DTO, USER);
    const b = await service.create(ORG_A, { ...DTO, nicheName: ' led ' }, USER);

    expect(niches.rows).toHaveLength(1);
    expect(a.campaign.nicheId).toBe(b.campaign.nicheId);
  });

  // WHY: no FAILED state exists — a failed deploy leaves the campaign DRAFT with the
  // error surfaced so the operator can activate/retry. The launch never throws.
  it('stays DRAFT + surfaces deployError on a non-2xx webhook response', async () => {
    const { service } = seed(WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { campaign, deployError } = await service.create(ORG_A, DTO, USER);
    expect(campaign.lifecycle).toBe('DRAFT');
    expect(deployError).toContain('500');
  });

  it('stays DRAFT + surfaces deployError when the webhook throws', async () => {
    const { service } = seed(WEBHOOK);
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const { campaign, deployError } = await service.create(ORG_A, DTO, USER);
    expect(campaign.lifecycle).toBe('DRAFT');
    expect(deployError).toContain('ECONNREFUSED');
  });

  // WHY: safe to run before AIM is wired — no webhook configured means the campaign
  // simply saves as DRAFT (with an explanatory deployError), no fetch attempted.
  it('saves DRAFT without calling out when no AIM webhook is configured', async () => {
    const { service } = seed(''); // no webhook
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { campaign, deployError } = await service.create(ORG_A, DTO, USER);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(campaign.lifecycle).toBe('DRAFT');
    expect(deployError).toContain('not configured');
  });
});

describe('CampaignsService — lifecycle transitions', () => {
  async function draft(service: CampaignsService) {
    const { campaign } = await service.create(ORG_A, DTO, USER);
    return campaign;
  }

  it('DRAFT → ACTIVE → PAUSED → ACTIVE is allowed', async () => {
    const { service } = seed(''); // DRAFT (no webhook)
    const c = await draft(service);

    let r = await service.updateLifecycle(ORG_A, c.id, 'ACTIVE');
    expect(r.after.lifecycle).toBe('ACTIVE');
    r = await service.updateLifecycle(ORG_A, c.id, 'PAUSED');
    expect(r.after.lifecycle).toBe('PAUSED');
    r = await service.updateLifecycle(ORG_A, c.id, 'ACTIVE');
    expect(r.after.lifecycle).toBe('ACTIVE');
  });

  it('→ ARCHIVED stamps archivedAt and is terminal (422 on any further move)', async () => {
    const { service } = seed('');
    const c = await draft(service);

    const r = await service.updateLifecycle(ORG_A, c.id, 'ARCHIVED');
    expect(r.after.lifecycle).toBe('ARCHIVED');
    expect(r.after.archivedAt).toBeInstanceOf(Date);

    await expect(
      service.updateLifecycle(ORG_A, c.id, 'ACTIVE'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an illegal transition (DRAFT → PAUSED) with 422', async () => {
    const { service } = seed('');
    const c = await draft(service);
    await expect(
      service.updateLifecycle(ORG_A, c.id, 'PAUSED'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('archived campaigns drop out of the default list', async () => {
    const { service } = seed('');
    const c = await draft(service);
    await service.updateLifecycle(ORG_A, c.id, 'ARCHIVED');
    expect(await service.list(ORG_A)).toEqual([]);
  });
});

describe('CampaignsService — machine config + list', () => {
  it('getConfig returns the launch inputs + the niche with its ENABLED targets', async () => {
    const { service, niches, nicheTargets } = seed('');
    const { campaign } = await service.create(ORG_A, DTO, USER);
    const nicheId = niches.rows[0]!.id as string;

    // One enabled + one disabled target on the niche — config returns enabled only.
    nicheTargets.rows.push(
      {
        id: 't-on',
        nicheId,
        name: 'Provider',
        slug: 'provider',
        searchHint: 'cloud provider',
        source: 'AI',
        enabled: true,
        __seq: 1,
      },
      {
        id: 't-off',
        nicheId,
        name: 'Installer',
        slug: 'installer',
        searchHint: null,
        source: 'AI',
        enabled: false,
        __seq: 2,
      },
    );

    const cfg = await service.getConfig(campaign.id);
    expect(cfg.campaignId).toBe(campaign.id);
    expect(cfg.region).toBe('North');
    expect(cfg.niche.name).toBe('LED');
    expect(cfg.niche.targets.map((t) => t.id)).toEqual(['t-on']);
    expect(cfg.niche.targets[0]!.searchHint).toBe('cloud provider');

    // The GLOBAL workflow_config automation knobs ride along on the machine config.
    // With no seeded workflow_config row (the fake table auto-vivifies to empty) the
    // templates are all unset (null) and the leads gate booleans resolve to their
    // safe `true` default; defaultRegions falls back to [].
    expect(cfg.automation.templates).toEqual({
      default: null,
      signature: null,
      signatureImageUrl: null,
      tone: null,
      language: null,
    });
    expect(cfg.automation.leads).toEqual({
      maxLeadsPerRun: null,
      maxPerNiche: null,
      dailySendCap: null,
      defaultRegions: [],
      respectSuppressions: true,
      dedupDays: null,
      requireNicheAnalysis: true,
    });
  });

  it('getConfig 404s for an unknown campaign id', async () => {
    const { service } = seed('');
    await expect(
      service.getConfig('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('machineList filters by lifecycle (ACTIVE only)', async () => {
    const { service } = seed(WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const active = await service.create(ORG_A, DTO, USER); // → ACTIVE

    // A second, DRAFT campaign (the webhook errors on this call) — stays DRAFT.
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('down')) as unknown as typeof fetch;
    await service.create(ORG_A, { ...DTO, project: 'P2' }, USER); // → DRAFT

    const list = await service.machineList('ACTIVE');
    expect(list.map((c) => c.id)).toEqual([active.campaign.id]);
    expect(list[0]!.nicheId).toBe(active.campaign.nicheId);
  });

  // REGRESSION (Drive→Postgres migration): CampaignDto gained `nicheName`, but the
  // Postgres service returned raw campaign rows with no niche join — so every
  // campaign shipped WITHOUT nicheName and the web client rejected /campaigns with
  // "Unexpected response shape from API." list/get/create/lifecycle must each carry
  // the joined niche display name (the campaigns table stores only nicheId).
  it('joins the niche display name onto campaigns (CampaignDto.nicheName)', async () => {
    const { service } = seed(''); // DRAFT, no webhook
    const { campaign } = await service.create(ORG_A, DTO, USER);
    expect(campaign.nicheName).toBe('LED'); // create()

    expect((await service.get(ORG_A, campaign.id)).nicheName).toBe('LED'); // get()

    const [listed] = await service.list(ORG_A);
    expect(listed!.nicheName).toBe('LED'); // list()

    const { after } = await service.updateLifecycle(ORG_A, campaign.id, 'ACTIVE');
    expect(after.nicheName).toBe('LED'); // updateLifecycle()
  });
});

describe('CampaignsService — tenant isolation + delete', () => {
  it('get 404s across orgs and list is scoped to the calling org', async () => {
    const { service } = seed('');
    const { campaign } = await service.create(ORG_A, DTO, USER);

    await expect(service.get(ORG_B, campaign.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.list(ORG_B)).toEqual([]);
    expect((await service.list(ORG_A)).map((r) => r.id)).toEqual([campaign.id]);
  });

  // WHY: delete removes the ERP record but KEEPS the arsenal-run log (detach the FK).
  it('deletes the campaign and detaches its arsenal runs (kept, campaignId nulled)', async () => {
    const { service, campaigns, arsenalRuns } = seed('');
    const { campaign } = await service.create(ORG_A, DTO, USER);
    arsenalRuns.rows.push({
      id: 'run-1',
      organizationId: ORG_A,
      stage: 'AMMO_FORGE',
      campaignId: campaign.id,
      source: 'N8N',
      status: 'SUCCESS',
      __seq: 1,
    });

    const before = await service.delete(ORG_A, campaign.id);
    expect(before.id).toBe(campaign.id);
    expect(campaigns.rows).toHaveLength(0);
    expect(arsenalRuns.rows).toHaveLength(1);
    expect(arsenalRuns.rows[0]!.campaignId).toBeNull();
  });

  it('404s deleting a campaign in another org', async () => {
    const { service } = seed('');
    const { campaign } = await service.create(ORG_A, DTO, USER);
    await expect(service.delete(ORG_B, campaign.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
