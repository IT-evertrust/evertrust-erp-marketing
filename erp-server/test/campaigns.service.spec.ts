import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { schema } from '@evertrust/db';
import { DEFAULT_SENDERS, type CreateCampaignDto } from '@evertrust/shared';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { NichesService } from '../src/niches/niches.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { randomUUID } from 'crypto';
import { getDb, makeWorkflowConfig, rowsOf, seed } from './real-db';

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

function setup(webhookUrl = '') {
  const db = getDb();
  const nichesService = new NichesService(db);
  return {
    service: new CampaignsService(
      db,
      makeWorkflowConfig(db, makeConfig(webhookUrl)),
      nichesService,
    ),
    nichesService,
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
    const { service } = setup(WEBHOOK);
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
    const nicheRows = await rowsOf(schema.niches);
    expect(nicheRows).toHaveLength(1);
    expect(campaign.nicheId).toBe(nicheRows[0]!.id);
  });

  // WHY: a second campaign in the same niche must REUSE the niche row (find-or-create
  // is the dedup), not create a duplicate.
  it('reuses an existing niche across campaigns (find-or-create by slug)', async () => {
    const { service } = setup(WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const a = await service.create(ORG_A, DTO, USER);
    const b = await service.create(ORG_A, { ...DTO, nicheName: ' led ' }, USER);

    expect(await rowsOf(schema.niches)).toHaveLength(1);
    expect(a.campaign.nicheId).toBe(b.campaign.nicheId);
  });

  // WHY: no FAILED state exists — a failed deploy leaves the campaign DRAFT with the
  // error surfaced so the operator can activate/retry, and the launch never throws.
  // (Regression guard: the real-Postgres migration surfaced a bug where create() ran an
  // empty `db.update(...).set({})` on the failed-deploy path — which real Postgres
  // rejects with "No values to set". Fixed by skipping the write when the patch is
  // empty; these two specs pin the intended DRAFT-with-error behavior.)
  it('stays DRAFT + surfaces deployError on a non-2xx webhook response', async () => {
    const { service } = setup(WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { campaign, deployError } = await service.create(ORG_A, DTO, USER);
    expect(campaign.lifecycle).toBe('DRAFT');
    expect(campaign.activatedBy).toBeNull();
    expect(deployError).toContain('HTTP 500');
  });

  it('stays DRAFT + surfaces deployError when the webhook throws', async () => {
    const { service } = setup(WEBHOOK);
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
    const { service } = setup(''); // no webhook
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { campaign, deployError } = await service.create(ORG_A, DTO, USER);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(campaign.lifecycle).toBe('DRAFT');
    expect(deployError).toContain('not configured');
  });

  // WHY: the campaign sender must be one of the org's RESOLVED sender keys. With no
  // org_senders rows the org falls back to DEFAULT_SENDERS, so an unknown key is 400
  // (no campaign persisted), while the legacy 'info'/'hanna' keys stay valid.
  it('rejects an unknown sender key (400) and never persists the campaign', async () => {
    const { service } = setup('');
    await expect(
      service.create(ORG_A, { ...DTO, sender: 'nobody' }, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await rowsOf(schema.campaigns)).toHaveLength(0);
  });

  it('keeps the legacy DEFAULT_SENDERS keys valid (info + hanna)', async () => {
    const { service } = setup('');
    const a = await service.create(ORG_A, { ...DTO, sender: 'info' }, USER);
    expect(a.campaign.sender).toBe('info');
    const b = await service.create(
      ORG_A,
      { ...DTO, project: 'P-hanna', sender: 'hanna' },
      USER,
    );
    expect(b.campaign.sender).toBe('hanna');
  });
});

describe('CampaignsService — lifecycle transitions', () => {
  async function draft(service: CampaignsService) {
    const { campaign } = await service.create(ORG_A, DTO, USER);
    return campaign;
  }

  it('DRAFT → ACTIVE → PAUSED → ACTIVE is allowed', async () => {
    const { service } = setup(''); // DRAFT (no webhook)
    const c = await draft(service);

    let r = await service.updateLifecycle(ORG_A, c.id, 'ACTIVE');
    expect(r.after.lifecycle).toBe('ACTIVE');
    r = await service.updateLifecycle(ORG_A, c.id, 'PAUSED');
    expect(r.after.lifecycle).toBe('PAUSED');
    r = await service.updateLifecycle(ORG_A, c.id, 'ACTIVE');
    expect(r.after.lifecycle).toBe('ACTIVE');
  });

  it('→ ARCHIVED stamps archivedAt and is terminal (422 on any further move)', async () => {
    const { service } = setup('');
    const c = await draft(service);

    const r = await service.updateLifecycle(ORG_A, c.id, 'ARCHIVED');
    expect(r.after.lifecycle).toBe('ARCHIVED');
    expect(r.after.archivedAt).toBeInstanceOf(Date);

    await expect(
      service.updateLifecycle(ORG_A, c.id, 'ACTIVE'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an illegal transition (DRAFT → PAUSED) with 422', async () => {
    const { service } = setup('');
    const c = await draft(service);
    await expect(
      service.updateLifecycle(ORG_A, c.id, 'PAUSED'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('archived campaigns drop out of the default list', async () => {
    const { service } = setup('');
    const c = await draft(service);
    await service.updateLifecycle(ORG_A, c.id, 'ARCHIVED');
    expect(await service.list(ORG_A)).toEqual([]);
  });
});

describe('CampaignsService — machine config + list', () => {
  it('getConfig returns the launch inputs + the niche with its ENABLED targets', async () => {
    const T_ON = '11111111-1111-1111-1111-111111111111';
    const T_OFF = '22222222-2222-2222-2222-222222222222';
    const { service } = setup('');
    const { campaign } = await service.create(ORG_A, DTO, USER);
    const nicheId = (await rowsOf(schema.niches))[0]!.id as string;

    // One enabled + one disabled target on the niche — config returns enabled only.
    await seed(schema.nicheTargets, [
      {
        id: T_ON,
        nicheId,
        name: 'Provider',
        slug: 'provider',
        searchHint: 'cloud provider',
        source: 'AI',
        enabled: true,
      },
      {
        id: T_OFF,
        nicheId,
        name: 'Installer',
        slug: 'installer',
        searchHint: null,
        source: 'AI',
        enabled: false,
      },
    ]);

    const cfg = await service.getConfig(campaign.id);
    expect(cfg.campaignId).toBe(campaign.id);
    expect(cfg.region).toBe('North');
    expect(cfg.niche.name).toBe('LED');
    expect(cfg.niche.targets.map((t) => t.id)).toEqual([T_ON]);
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

    // The per-org senders + the resolved default sender EMAIL + the org sales calendar
    // ride along on the same automation block (the seam n8n reads). With no org_senders
    // rows the list is the product DEFAULT_SENDERS and the default From is info@.
    expect(cfg.automation.senders).toEqual(DEFAULT_SENDERS);
    expect(cfg.automation.defaultSenderEmail).toBe('info@evertrust-germany.de');
    // No org_config + no SALES_CALENDAR_ID env → the org sales calendar resolves null
    // (distinct from the campaign's OWN salesCalendarId at cfg.salesCalendarId).
    expect(cfg.automation.salesCalendarId).toBeNull();
  });

  it('getConfig 404s for an unknown campaign id', async () => {
    const { service } = setup('');
    await expect(
      service.getConfig('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('machineList filters by lifecycle (ACTIVE only)', async () => {
    const { service } = setup(WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const active = await service.create(ORG_A, DTO, USER); // → ACTIVE

    // A second, DRAFT campaign, created via a no-webhook service so it saves DRAFT
    // through the early-return path (no AIM call).
    const { service: draftService } = setup(''); // no AIM webhook → DRAFT
    await draftService.create(ORG_A, { ...DTO, project: 'P2' }, USER); // → DRAFT

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
    const { service } = setup(''); // DRAFT, no webhook
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
    const { service } = setup('');
    const { campaign } = await service.create(ORG_A, DTO, USER);

    await expect(service.get(ORG_B, campaign.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.list(ORG_B)).toEqual([]);
    expect((await service.list(ORG_A)).map((r) => r.id)).toEqual([campaign.id]);
  });

  // WHY: delete removes the ERP record but KEEPS the arsenal-run log (detach the FK).
  it('deletes the campaign and detaches its arsenal runs (kept, campaignId nulled)', async () => {
    const { service } = setup('');
    const { campaign } = await service.create(ORG_A, DTO, USER);
    await seed(schema.arsenalRuns, [
      {
        id: randomUUID(),
        organizationId: ORG_A,
        stage: 'AMMO_FORGE',
        campaignId: campaign.id,
        source: 'N8N',
        status: 'SUCCESS',
      },
    ]);

    const before = await service.delete(ORG_A, campaign.id);
    expect(before.id).toBe(campaign.id);
    expect(await rowsOf(schema.campaigns)).toHaveLength(0);
    const runs = await rowsOf(schema.arsenalRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.campaignId).toBeNull();
  });

  it('404s deleting a campaign in another org', async () => {
    const { service } = setup('');
    const { campaign } = await service.create(ORG_A, DTO, USER);
    await expect(service.delete(ORG_B, campaign.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
