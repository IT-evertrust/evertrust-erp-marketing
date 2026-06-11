import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import type { CreateCampaignDto } from '@evertrust/shared';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const WEBHOOK = 'https://evertrustgmbh.app.n8n.cloud/webhook/aim-deploy-campaign';
const LIST_WEBHOOK =
  'https://evertrustgmbh.app.n8n.cloud/webhook/erp-campaigns-list';

const DTO: CreateCampaignDto = {
  niche: 'LED',
  target: 'EPC',
  country: 'Germany',
  state: 'North',
  project: 'LED Retrofit Berlin 2026',
  gmailLabel: 'LED-Berlin-2026',
  salesCalendarId: 'info@evertrust-germany.de',
  whatsappNumber: '+4915112345678',
  sender: 'info',
};

// Minimal AppConfigService stub — the service reads N8N_AIM_WEBHOOK_URL (deploy)
// and N8N_CAMPAIGNS_LIST_WEBHOOK_URL (Drive sync).
function makeConfig(aimUrl: string, campaignsListUrl = ''): AppConfigService {
  const values: Record<string, string> = {
    N8N_AIM_WEBHOOK_URL: aimUrl,
    N8N_CAMPAIGNS_LIST_WEBHOOK_URL: campaignsListUrl,
  };
  return {
    get: (k: string) => values[k] ?? '',
  } as unknown as AppConfigService;
}

function seed(webhookUrl = '', campaignsListUrl = '') {
  const campaigns = new FakeTable([]);
  const arsenalRuns = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.campaigns, campaigns],
      [schema.arsenalRuns, arsenalRuns],
    ]),
  );
  return {
    service: new CampaignsService(db, makeConfig(webhookUrl, campaignsListUrl)),
    campaigns,
    arsenalRuns,
  };
}

// fetch mock returning the erp-campaigns-list webhook payload.
function mockDriveList(folders: { id: string; name?: string }[]) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      folderUrl: 'https://drive.google.com/drive/folders/parent',
      campaigns: folders.map((f) => ({ id: f.id, name: f.name ?? f.id })),
    }),
  }) as unknown as typeof fetch;
}

// Create a DEPLOYED campaign whose Drive folder id is `folderId` (mocks the AIM
// deploy webhook just for this create call).
async function deploy(
  service: CampaignsService,
  folderId: string,
): Promise<string> {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    }),
  }) as unknown as typeof fetch;
  const row = await service.create(ORG_A, DTO, USER);
  return row.id;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CampaignsService — launch (create + AIM deploy)', () => {
  // WHY: ERP-first. The campaign must persist regardless of the webhook outcome,
  // and the server owns organizationId + status. With no webhook configured the
  // deploy is SKIPPED (DRAFT) — the feature is safe before the webhook is set.
  it('persists a DRAFT campaign and skips deploy when no webhook is configured', async () => {
    const { service, campaigns } = seed('');
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const row = await service.create(ORG_A, DTO, USER);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(row.status).toBe('DRAFT');
    expect(row.organizationId).toBe(ORG_A);
    expect(row.niche).toBe('LED');
    expect(row.state).toBe('North');
    expect(row.driveFolderUrl).toBeFalsy();
    expect(campaigns.rows).toHaveLength(1);
  });

  // WHY: a successful AIM deploy is what turns a saved target into a live campaign;
  // the Drive folder ref + decider must be captured for the operator + audit.
  it('fires the AIM webhook and records DEPLOYED + Drive folder on success', async () => {
    const { service } = seed(WEBHOOK);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        folderId: 'F1',
        folderUrl: 'https://drive.google.com/drive/folders/F1',
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const row = await service.create(ORG_A, DTO, USER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(opts.method).toBe('POST');
    // The 9 AIM inputs are POSTed verbatim (matches the reference form payload).
    expect(JSON.parse(opts.body as string)).toMatchObject({
      niche: 'LED',
      state: 'North',
      // `region` is aliased from `state` so AIM's config.json (which reads
      // body.region) carries the location zone — otherwise Lead Satellite gets
      // 0 cities and bails.
      region: 'North',
      gmailLabel: 'LED-Berlin-2026',
      // sender is passed through verbatim → AIM writes it into config.json,
      // BAZOOKA branches on it to pick the Gmail credential.
      sender: 'info',
    });
    expect(row.status).toBe('DEPLOYED');
    expect(row.driveFolderUrl).toBe('https://drive.google.com/drive/folders/F1');
    expect(row.driveFolderId).toBe('F1');
    expect(row.deployedBy).toBe(USER);
    expect(row.deployedAt).toBeInstanceOf(Date);
  });

  // WHY: failure must be OBSERVABLE, not a 500. A bad webhook response records
  // FAILED + the reason so the operator can retry — the launch never throws.
  it('records FAILED + deployError on a non-2xx webhook response', async () => {
    const { service } = seed(WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const row = await service.create(ORG_A, DTO, USER);
    expect(row.status).toBe('FAILED');
    expect(row.deployError).toContain('500');
  });

  it('records FAILED when the webhook call throws (network error)', async () => {
    const { service } = seed(WEBHOOK);
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const row = await service.create(ORG_A, DTO, USER);
    expect(row.status).toBe('FAILED');
    expect(row.deployError).toContain('ECONNREFUSED');
  });
});

describe('CampaignsService — tenant isolation', () => {
  it('get 404s across orgs and list is scoped to the calling org', async () => {
    const { service } = seed('');
    const a = await service.create(ORG_A, DTO, USER);

    await expect(service.get(ORG_B, a.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.list(ORG_B)).toEqual([]);
    expect((await service.list(ORG_A)).map((r) => r.id)).toEqual([a.id]);
  });
});

describe('CampaignsService — delete', () => {
  // WHY: delete removes the ERP record but must KEEP the arsenal-run log (detach
  // the FK, don't destroy history), and must never cross tenants.
  it('deletes the campaign and detaches its arsenal runs (kept, campaignId nulled)', async () => {
    const { service, campaigns, arsenalRuns } = seed();
    const c = await service.create(ORG_A, DTO, USER);
    arsenalRuns.rows.push({
      id: 'run-1',
      organizationId: ORG_A,
      stage: 'AMMO_FORGE',
      campaignId: c.id,
      source: 'MANUAL',
      status: 'DISPATCHED',
      detail: null,
      triggeredBy: USER,
      createdAt: new Date(),
      __seq: 1,
    });

    const before = await service.delete(ORG_A, c.id);

    expect(before.id).toBe(c.id);
    expect(campaigns.rows).toHaveLength(0);
    // the run is preserved, just detached from the deleted campaign
    expect(arsenalRuns.rows).toHaveLength(1);
    expect(arsenalRuns.rows[0]!.campaignId).toBeNull();
  });

  it('404s deleting a campaign in another org', async () => {
    const { service } = seed();
    const c = await service.create(ORG_A, DTO, USER);
    await expect(service.delete(ORG_B, c.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CampaignsService — Drive sync (reconcile against the folder)', () => {
  // WHY: the Drive "Evertrust Campaigns" folder is the SOURCE OF TRUTH. A campaign
  // whose folder was deleted must drop out of the list (archived, not destroyed);
  // one whose folder still exists must stay. This is the whole point of the sync —
  // n8n execution history can't be trusted to reflect deletions.
  it('archives a DEPLOYED campaign whose folder is gone and keeps a present one', async () => {
    const { service, campaigns } = seed(WEBHOOK, LIST_WEBHOOK);
    const gone = await deploy(service, 'F1');
    const kept = await deploy(service, 'F2');
    expect((await service.list(ORG_A)).length).toBe(2);

    // Drive now only contains F2.
    mockDriveList([{ id: 'F2', name: 'KEPT' }]);
    const res = await service.syncFromDrive(ORG_A);

    expect(res.driveCount).toBe(1);
    expect(res.checked).toBe(2);
    expect(res.markedMissing).toBe(1);
    expect(res.restored).toBe(0);

    // F1 is archived OUT of the active list, but the row is kept + flagged.
    expect((await service.list(ORG_A)).map((c) => c.id)).toEqual([kept]);
    const goneRow = campaigns.rows.find((r) => r.id === gone)!;
    expect(goneRow.driveMissing).toBe(true);
    expect(goneRow.driveCheckedAt).toBeInstanceOf(Date);
  });

  // WHY: deletions can be undone — re-adding the folder must bring the campaign back.
  it('un-archives a campaign when its folder reappears in Drive', async () => {
    const { service, campaigns } = seed(WEBHOOK, LIST_WEBHOOK);
    const id = await deploy(service, 'F9');
    campaigns.rows.find((r) => r.id === id)!.driveMissing = true; // prior sync archived it
    expect((await service.list(ORG_A)).length).toBe(0);

    mockDriveList([{ id: 'F9', name: 'BACK' }]);
    const res = await service.syncFromDrive(ORG_A);

    expect(res.restored).toBe(1);
    expect(res.markedMissing).toBe(0);
    expect((await service.list(ORG_A)).map((c) => c.id)).toEqual([id]);
  });

  // WHY: DRAFT/FAILED rows have no folder yet — they aren't Drive-reconcilable and
  // must be left alone. Folders with no ERP row are surfaced as `untracked`, not
  // auto-imported.
  it('leaves folder-less (DRAFT) campaigns alone and reports untracked Drive folders', async () => {
    const { service } = seed('', LIST_WEBHOOK); // no AIM webhook → DRAFT, no folder id
    const draft = await service.create(ORG_A, DTO, USER);
    expect(draft.status).toBe('DRAFT');

    mockDriveList([{ id: 'X1', name: 'EXTERNAL' }]);
    const res = await service.syncFromDrive(ORG_A);

    expect(res.checked).toBe(0);
    expect(res.markedMissing).toBe(0);
    expect(res.untracked).toEqual([{ id: 'X1', name: 'EXTERNAL' }]);
    expect((await service.list(ORG_A)).map((c) => c.id)).toEqual([draft.id]);
  });

  // WHY: a sync failure must be OBSERVABLE (503), never a silent no-op that leaves
  // stale rows looking valid.
  it('throws ServiceUnavailable when the sync webhook is not configured', async () => {
    const { service } = seed('', '');
    await expect(service.syncFromDrive(ORG_A)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailable when the webhook returns non-200', async () => {
    const { service } = seed('', LIST_WEBHOOK);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    await expect(service.syncFromDrive(ORG_A)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
