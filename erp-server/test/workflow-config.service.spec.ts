import { createHash } from 'node:crypto';
import { schema } from '@evertrust/db';
import { WorkflowConfigService } from '../src/arsenal/workflow-config.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb } from './fake-db';

// WorkflowConfigService resolves the GLOBAL Growth-Engine INFRA (webhooks, n8n base,
// ingest token, offsets) as stored-override ?? env from the workflow_config singleton,
// and the PER-ORG prefs (templates, leads, default sender) as org_config(orgId) value
// ?? product default. These tests pin both halves: env/default fallback when no row
// exists, and the stored value winning when one does. The fake db auto-vivifies both
// tables to [] when unseeded; org_config find-or-create inserts a bare row on first
// read.

// The org under test for every per-org pref read/write.
const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeConfig(values: Record<string, string> = {}): AppConfigService {
  return { get: (k: string) => values[k] ?? '' } as unknown as AppConfigService;
}

// Build the service over an optional seeded INFRA singleton row and an optional
// seeded PER-ORG prefs row (org_config for ORG). `row` carries infra OR pref values;
// it is split across the two backing tables so each spec can keep passing one flat
// object: infra keys land on workflow_config, pref keys on org_config(ORG).
const PREF_KEYS = new Set([
  'defaultTemplate',
  'signature',
  'signatureImageUrl',
  'tone',
  'templateLanguage',
  'defaultSender',
  'maxLeadsPerRun',
  'maxPerNiche',
  'dailySendCap',
  'defaultRegions',
  'respectSuppressions',
  'dedupDays',
  'requireNicheAnalysis',
]);

function make(env: Record<string, string> = {}, row?: Record<string, unknown>) {
  const infraVals: Record<string, unknown> = {};
  const prefVals: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    (PREF_KEYS.has(k) ? prefVals : infraVals)[k] = v;
  }
  const hasInfra = Object.keys(infraVals).length > 0;
  const hasPref = Object.keys(prefVals).length > 0;

  const workflowConfig = new FakeTable(
    hasInfra ? [{ id: 'wc1', singleton: true, ...infraVals }] : [],
  );
  const orgConfig = new FakeTable(
    hasPref ? [{ id: 'oc1', organizationId: ORG, ...prefVals }] : [],
  );
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.workflowConfig, workflowConfig],
      [schema.orgConfig, orgConfig],
    ]),
  );
  return {
    service: new WorkflowConfigService(db, makeConfig(env)),
    workflowConfig,
    orgConfig,
  };
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
    const eff = await service.getEffective(ORG);
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
    const eff = await service.getEffective(ORG);
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
    const eff = await service.getEffective(ORG);
    expect(eff.ingestTokenSource).toBe('rotated');
    expect(eff.ingestTokenSetAt).toBe('2026-06-13T00:00:00.000Z');
  });
});

describe('WorkflowConfigService — templates + leads groups', () => {
  it('getEffective: unset row → booleans default to true, caps null, regions []', async () => {
    const { service } = make(ENV); // no stored row
    const eff = await service.getEffective(ORG);

    expect(eff.templates).toEqual({
      default: null,
      signature: null,
      tone: null,
      language: null,
    });
    expect(eff.leads).toEqual({
      maxLeadsPerRun: null,
      maxPerNiche: null,
      dailySendCap: null,
      defaultRegions: [],
      // EFFECTIVE safe defaults — an unset value must never read as "off".
      respectSuppressions: true,
      dedupDays: null,
      requireNicheAnalysis: true,
    });
  });

  it('getEffective: stored values surface verbatim (incl. a false boolean)', async () => {
    const template = {
      cold: { subject: 'Hi', body: 'Cold body' },
      followup: { subject: 'Re: Hi', body: 'Followup body' },
      finalPush: { subject: 'Last call', body: 'Final body' },
    };
    const { service } = make(ENV, {
      defaultTemplate: template,
      signature: 'Best, EverTrust',
      tone: 'formal',
      templateLanguage: 'de',
      maxLeadsPerRun: 200,
      maxPerNiche: 50,
      dailySendCap: 30,
      defaultRegions: ['Bayern', 'Hessen'],
      respectSuppressions: false,
      dedupDays: 14,
      requireNicheAnalysis: false,
    });
    const eff = await service.getEffective(ORG);

    expect(eff.templates).toEqual({
      default: template,
      signature: 'Best, EverTrust',
      tone: 'formal',
      language: 'de',
    });
    expect(eff.leads).toEqual({
      maxLeadsPerRun: 200,
      maxPerNiche: 50,
      dailySendCap: 30,
      defaultRegions: ['Bayern', 'Hessen'],
      respectSuppressions: false,
      dedupDays: 14,
      requireNicheAnalysis: false,
    });
  });

  it('update: round-trips a defaultTemplate + caps + a boolean set to false', async () => {
    const { service, orgConfig } = make(ENV);
    const template = {
      cold: { subject: 'Subject A', body: 'Body A' },
      followup: { subject: 'Subject B', body: 'Body B' },
      finalPush: { subject: 'Subject C', body: 'Body C' },
    };
    const eff = await service.update(
      {
        templates: { default: template, tone: 'direct', language: 'en' },
        leads: {
          maxLeadsPerRun: 120,
          dedupDays: 7,
          defaultRegions: ['NRW'],
          respectSuppressions: false,
        },
      },
      ORG,
    );

    // The prefs land on the PER-ORG org_config row (not the global singleton).
    expect(orgConfig.rows).toHaveLength(1);
    expect(eff.templates.default).toEqual(template);
    expect(eff.templates.tone).toBe('direct');
    expect(eff.templates.language).toBe('en');
    expect(eff.leads.maxLeadsPerRun).toBe(120);
    expect(eff.leads.dedupDays).toBe(7);
    expect(eff.leads.defaultRegions).toEqual(['NRW']);
    // A boolean explicitly set to false must persist as false (not the true default).
    expect(eff.leads.respectSuppressions).toBe(false);
    // An untouched boolean still resolves to its effective default.
    expect(eff.leads.requireNicheAnalysis).toBe(true);
  });

  it('update: null clears the defaultTemplate back to unset', async () => {
    const { service } = make(ENV, {
      defaultTemplate: {
        cold: { subject: 's', body: 'b' },
        followup: { subject: 's', body: 'b' },
        finalPush: { subject: 's', body: 'b' },
      },
    });
    const eff = await service.update({ templates: { default: null } }, ORG);
    expect(eff.templates.default).toBeNull();
  });
});

describe('WorkflowConfigService.getLeadStats', () => {
  const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // Seed leads/prospects/suppressions across two orgs; the count must be confined to
  // ORG (mirrors how the list endpoints scope via tenantScope/organizationId).
  function makeStats() {
    const leads = new FakeTable([
      { id: 'l1', organizationId: ORG, email: 'a@x.com' },
      { id: 'l2', organizationId: ORG, email: 'b@x.com' },
      { id: 'l3', organizationId: OTHER, email: 'c@x.com' }, // other org — excluded
    ]);
    const prospects = new FakeTable([
      { id: 'p1', organizationId: ORG, email: 'd@x.com' },
      { id: 'p2', organizationId: ORG, email: 'e@x.com' },
      { id: 'p3', organizationId: ORG, email: 'f@x.com' },
    ]);
    const suppressions = new FakeTable([
      { id: 's1', organizationId: ORG, email: 'g@x.com' },
      { id: 's2', organizationId: OTHER, email: 'h@x.com' }, // other org — excluded
    ]);
    const workflowConfig = new FakeTable([]);
    const { db } = makeFakeDb(
      new Map<unknown, FakeTable>([
        [schema.leads, leads],
        [schema.prospects, prospects],
        [schema.suppressions, suppressions],
        [schema.workflowConfig, workflowConfig],
      ]),
    );
    return new WorkflowConfigService(db, makeConfig(ENV));
  }

  it('counts leads/prospects/suppressions scoped to the org', async () => {
    const service = makeStats();
    const stats = await service.getLeadStats(ORG);
    expect(stats).toEqual({ leads: 2, prospects: 3, suppressed: 1 });
  });

  it('returns zeros for an org with no rows', async () => {
    const service = makeStats();
    const stats = await service.getLeadStats(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    );
    expect(stats).toEqual({ leads: 0, prospects: 0, suppressed: 0 });
  });
});

describe('WorkflowConfigService — update (singleton upsert)', () => {
  it('creates the singleton when none exists and applies the override', async () => {
    const { service, workflowConfig } = make(ENV);
    const eff = await service.update({ webhooks: { aim: 'https://put/aim' } }, ORG);
    expect(workflowConfig.rows).toHaveLength(1);
    expect(eff.webhooks.aim).toEqual({ value: 'https://put/aim', overridden: true });
  });

  it('clears an override back to env when null is sent', async () => {
    const { service } = make(ENV, { aimWebhookUrl: 'https://stored/aim' });
    const eff = await service.update({ webhooks: { aim: null } }, ORG);
    expect(eff.webhooks.aim).toEqual({ value: 'https://env/aim', overridden: false });
  });

  it('leaves omitted fields unchanged', async () => {
    const { service } = make(ENV, {
      aimWebhookUrl: 'https://stored/aim',
      n8nApiUrl: 'https://stored-n8n.test',
    });
    // only touch defaultSender (a PER-ORG pref) — webhooks/n8nApiUrl must persist
    const eff = await service.update({ defaultSender: 'hanna' }, ORG);
    expect(eff.defaultSender).toBe('hanna');
    expect(eff.webhooks.aim.value).toBe('https://stored/aim');
    expect(eff.n8nApiUrl.value).toBe('https://stored-n8n.test');
  });

  it('does not create a second row on a subsequent update', async () => {
    const { service, workflowConfig } = make(ENV);
    await service.update({ followupOffsetDays: 2 }, ORG);
    await service.update({ finalPushOffsetDays: 4 }, ORG);
    expect(workflowConfig.rows).toHaveLength(1);
    const eff = await service.getEffective(ORG);
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
    const eff = await service.getEffective(ORG);
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
    const eff = await service.getEffective(ORG);
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
