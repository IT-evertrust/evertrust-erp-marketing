import { createHash } from 'node:crypto';
import { schema } from '@evertrust/db';
import { WorkflowConfigService } from '../src/arsenal/workflow-config.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb } from './fake-db';

// WorkflowConfigService resolves the GLOBAL Growth-Engine wiring as
// stored-override ?? env. These tests pin the two halves of that contract: env
// fallback when no row exists, and the stored override winning when one does. The
// fake db auto-vivifies workflow_config to [] when unseeded.

function makeConfig(values: Record<string, string> = {}): AppConfigService {
  return { get: (k: string) => values[k] ?? '' } as unknown as AppConfigService;
}

// Build the service over an optional seeded singleton row.
function make(env: Record<string, string> = {}, row?: Record<string, unknown>) {
  const workflowConfig = new FakeTable(row ? [{ id: 'wc1', singleton: true, ...row }] : []);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([[schema.workflowConfig, workflowConfig]]),
  );
  return { service: new WorkflowConfigService(db, makeConfig(env)), workflowConfig };
}

const ENV = {
  N8N_AIM_WEBHOOK_URL: 'https://env/aim',
  N8N_LEAD_SATELLITE_WEBHOOK_URL: 'https://env/lead',
  N8N_REACH_BAZOOKA_WEBHOOK_URL: 'https://env/bazooka',
  N8N_API_URL: 'https://env-n8n.test',
  N8N_API_KEY: 'env-key',
  ARSENAL_INGEST_TOKEN: 'env-token',
};

describe('WorkflowConfigService — env fallback (no stored row)', () => {
  it('getStageWebhook falls back to the env var', async () => {
    const { service } = make(ENV);
    expect(await service.getStageWebhook('LEAD_SATELLITE')).toBe('https://env/lead');
    expect(await service.getStageWebhook('REACH_BAZOOKA')).toBe('https://env/bazooka');
  });

  it('getAimWebhook / getN8nApiUrl fall back to env', async () => {
    const { service } = make(ENV);
    expect(await service.getAimWebhook()).toBe('https://env/aim');
    expect(await service.getN8nApiUrl()).toBe('https://env-n8n.test');
  });

  it('returns undefined when neither a row nor the env var is set', async () => {
    const { service } = make({});
    expect(await service.getStageWebhook('REPLY_GLOCK')).toBeUndefined();
    expect(await service.getAimWebhook()).toBeUndefined();
    expect(await service.getN8nApiUrl()).toBeUndefined();
  });

  it('getIngestTokenHash is null with no row (guard uses the env fallback)', async () => {
    const { service } = make(ENV);
    expect(await service.getIngestTokenHash()).toBeNull();
  });

  it('getEffective reports env values as not-overridden + status flags', async () => {
    const { service } = make(ENV);
    const eff = await service.getEffective();
    expect(eff.webhooks.aim).toEqual({ value: 'https://env/aim', overridden: false });
    expect(eff.n8nApiUrl).toEqual({ value: 'https://env-n8n.test', overridden: false });
    expect(eff.n8nApiKeySet).toBe(true);
    expect(eff.ingestTokenSet).toBe(true);
    expect(eff.ingestTokenSource).toBe('env');
    expect(eff.ingestTokenSetAt).toBeNull();
  });
});

describe('WorkflowConfigService — stored override wins', () => {
  it('a stored webhook URL overrides the env var', async () => {
    const { service } = make(ENV, {
      leadSatelliteWebhookUrl: 'https://stored/lead',
      n8nApiUrl: 'https://stored-n8n.test',
    });
    expect(await service.getStageWebhook('LEAD_SATELLITE')).toBe('https://stored/lead');
    expect(await service.getN8nApiUrl()).toBe('https://stored-n8n.test');
    // unset override still falls back to env
    expect(await service.getStageWebhook('REACH_BAZOOKA')).toBe('https://env/bazooka');
  });

  it('getEffective marks an overridden field and keeps others on env', async () => {
    const { service } = make(ENV, { aimWebhookUrl: 'https://stored/aim' });
    const eff = await service.getEffective();
    expect(eff.webhooks.aim).toEqual({ value: 'https://stored/aim', overridden: true });
    expect(eff.webhooks.leadSatellite).toEqual({
      value: 'https://env/lead',
      overridden: false,
    });
  });

  it('a stored ingest-token hash flips ingestTokenSource to rotated', async () => {
    const { service } = make(ENV, {
      ingestTokenHash: 'a'.repeat(64),
      ingestTokenSetAt: new Date('2026-06-13T00:00:00Z'),
    });
    expect(await service.getIngestTokenHash()).toBe('a'.repeat(64));
    const eff = await service.getEffective();
    expect(eff.ingestTokenSource).toBe('rotated');
    expect(eff.ingestTokenSetAt).toBe('2026-06-13T00:00:00.000Z');
  });
});

describe('WorkflowConfigService — update (singleton upsert)', () => {
  it('creates the singleton when none exists and applies the override', async () => {
    const { service, workflowConfig } = make(ENV);
    const eff = await service.update({ webhooks: { aim: 'https://put/aim' } });
    expect(workflowConfig.rows).toHaveLength(1);
    expect(eff.webhooks.aim).toEqual({ value: 'https://put/aim', overridden: true });
  });

  it('clears an override back to env when null is sent', async () => {
    const { service } = make(ENV, { aimWebhookUrl: 'https://stored/aim' });
    const eff = await service.update({ webhooks: { aim: null } });
    expect(eff.webhooks.aim).toEqual({ value: 'https://env/aim', overridden: false });
  });

  it('leaves omitted fields unchanged', async () => {
    const { service } = make(ENV, {
      aimWebhookUrl: 'https://stored/aim',
      n8nApiUrl: 'https://stored-n8n.test',
    });
    // only touch defaultSender — webhooks/n8nApiUrl must persist
    const eff = await service.update({ defaultSender: 'hanna' });
    expect(eff.defaultSender).toBe('hanna');
    expect(eff.webhooks.aim.value).toBe('https://stored/aim');
    expect(eff.n8nApiUrl.value).toBe('https://stored-n8n.test');
  });

  it('does not create a second row on a subsequent update', async () => {
    const { service, workflowConfig } = make(ENV);
    await service.update({ followupOffsetDays: 2 });
    await service.update({ finalPushOffsetDays: 4 });
    expect(workflowConfig.rows).toHaveLength(1);
    const eff = await service.getEffective();
    expect(eff.followupOffsetDays).toBe(2);
    expect(eff.finalPushOffsetDays).toBe(4);
  });
});

describe('WorkflowConfigService.rotateIngestToken', () => {
  it('returns a non-empty token and stores its SHA-256 hash (the guard would accept it)', async () => {
    const { service } = make(ENV);
    const { token, setAt } = await service.rotateIngestToken();

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(setAt).toBeInstanceOf(Date);

    // The stored hash is exactly sha256(token) — i.e. what ArsenalTokenGuard compares
    // the hashed incoming x-arsenal-token against, so this very token authenticates.
    const stored = await service.getIngestTokenHash();
    const expected = createHash('sha256').update(token).digest('hex');
    expect(stored).toBe(expected);

    // ...and the rotation is surfaced via getEffective() with the same set-at.
    const eff = await service.getEffective();
    expect(eff.ingestTokenSource).toBe('rotated');
    expect(eff.ingestTokenSet).toBe(true);
    expect(eff.ingestTokenSetAt).toBe(setAt.toISOString());
  });

  it('mints a different token each rotation (latest hash wins)', async () => {
    const { service } = make(ENV);
    const a = await service.rotateIngestToken();
    const b = await service.rotateIngestToken();
    expect(a.token).not.toBe(b.token);
    expect(await service.getIngestTokenHash()).toBe(
      createHash('sha256').update(b.token).digest('hex'),
    );
  });
});

describe('WorkflowConfigService.clearIngestToken', () => {
  it('nulls the stored hash, reverting to the env-token fallback', async () => {
    const { service } = make(ENV);
    await service.rotateIngestToken();
    expect(await service.getIngestTokenHash()).not.toBeNull();

    await service.clearIngestToken();
    expect(await service.getIngestTokenHash()).toBeNull();

    // env-token is still set, so the source falls back to 'env' (not 'none').
    const eff = await service.getEffective();
    expect(eff.ingestTokenSource).toBe('env');
    expect(eff.ingestTokenSetAt).toBeNull();
  });
});

describe('WorkflowConfigService.testN8nConnection', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports configured:false when the n8n URL or key is unset (no network)', async () => {
    // fetch must NOT be called on the unconfigured path.
    globalThis.fetch = jest.fn(() => {
      throw new Error('fetch should not be called when unconfigured');
    }) as unknown as typeof fetch;

    const { service } = make({}); // no N8N_API_URL / N8N_API_KEY
    const res = await service.testN8nConnection();
    expect(res).toEqual({
      ok: false,
      configured: false,
      detail: 'n8n API URL or key not set',
      workflowCount: null,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns ok:true with the workflow count on a 2xx (X-N8N-API-KEY header sent)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'wf1' }] }),
    }) as unknown as typeof fetch;

    const { service } = make({ N8N_API_URL: 'https://n8n.test', N8N_API_KEY: 'k' });
    const res = await service.testN8nConnection();
    expect(res).toEqual({
      ok: true,
      configured: true,
      detail: 'Connected',
      workflowCount: 1,
    });

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://n8n.test/api/v1/workflows?limit=1');
    expect(init.headers['X-N8N-API-KEY']).toBe('k');
  });

  it('returns ok:false with the HTTP status on a non-2xx (never throws)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { service } = make({ N8N_API_URL: 'https://n8n.test', N8N_API_KEY: 'k' });
    const res = await service.testN8nConnection();
    expect(res.ok).toBe(false);
    expect(res.configured).toBe(true);
    expect(res.detail).toBe('HTTP 401');
    expect(res.workflowCount).toBeNull();
  });

  it('surfaces a network error in detail (never throws)', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const { service } = make({ N8N_API_URL: 'https://n8n.test', N8N_API_KEY: 'k' });
    const res = await service.testN8nConnection();
    expect(res.ok).toBe(false);
    expect(res.configured).toBe(true);
    expect(res.detail).toBe('ECONNREFUSED');
    expect(res.workflowCount).toBeNull();
  });
});
