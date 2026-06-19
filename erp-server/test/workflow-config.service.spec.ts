import { createHash } from 'node:crypto';
import { schema } from '@evertrust/db';
import { DEFAULT_SENDERS } from '@evertrust/shared';
import { WorkflowConfigService } from '../src/arsenal/workflow-config.service';
import { SendersService } from '../src/arsenal/senders.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { fakeGoogleAccounts, getDb, rowsOf, seed } from './real-db';

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
  'salesCalendarId',
  'salesTimeZone',
  'salesSecondaryTimeZone',
  'agentLlmBaseUrl',
  'agentLlmModel',
  'scrapeLeadTarget',
  'scrapeMaxQueries',
  'scrapeMinScore',
  'maxLeadsPerRun',
  'maxPerNiche',
  'dailySendCap',
  'defaultRegions',
  'respectSuppressions',
  'dedupDays',
  'requireNicheAnalysis',
]);

async function make(
  env: Record<string, string> = {},
  row?: Record<string, unknown>,
  senderRows: Record<string, unknown>[] = [],
) {
  const infraVals: Record<string, unknown> = {};
  const prefVals: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    (PREF_KEYS.has(k) ? prefVals : infraVals)[k] = v;
  }
  // The row carries infra OR pref values; infra keys land on the workflow_config
  // singleton, pref keys on org_config(ORG). The DB fills id/createdAt/updatedAt.
  if (Object.keys(infraVals).length > 0) {
    await seed(schema.workflowConfig, { singleton: true, ...infraVals });
  }
  if (Object.keys(prefVals).length > 0) {
    await seed(schema.orgConfig, { organizationId: ORG, ...prefVals });
  }
  if (senderRows.length > 0) await seed(schema.orgSenders, senderRows);

  const db = getDb();
  return {
    service: new WorkflowConfigService(
      db,
      makeConfig(env),
      new SendersService(db, fakeGoogleAccounts()),
    ),
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
    const { service } = await make(ENV);
    expect(await service.getStageWebhook('LEAD_SATELLITE')).toBe('https://env/lead');
    expect(await service.getStageWebhook('REACH_BAZOOKA')).toBe('https://env/bazooka');
  });

  it('getAimWebhook / getN8nApiUrl fall back to env', async () => {
    const { service } = await make(ENV);
    expect(await service.getAimWebhook()).toBe('https://env/aim');
    expect(await service.getN8nApiUrl()).toBe('https://env-n8n.test');
  });

  it('returns undefined when neither a row nor the env var is set', async () => {
    const { service } = await make({});
    expect(await service.getStageWebhook('REPLY_GLOCK')).toBeUndefined();
    expect(await service.getAimWebhook()).toBeUndefined();
    expect(await service.getN8nApiUrl()).toBeUndefined();
  });

  it('getIngestTokenHash is null with no row (guard uses the env fallback)', async () => {
    const { service } = await make(ENV);
    expect(await service.getIngestTokenHash()).toBeNull();
  });

  it('getEffective reports env values as not-overridden + status flags', async () => {
    const { service } = await make(ENV);
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
    const { service } = await make(ENV, {
      leadSatelliteWebhookUrl: 'https://stored/lead',
      n8nApiUrl: 'https://stored-n8n.test',
    });
    expect(await service.getStageWebhook('LEAD_SATELLITE')).toBe('https://stored/lead');
    expect(await service.getN8nApiUrl()).toBe('https://stored-n8n.test');
    // unset override still falls back to env
    expect(await service.getStageWebhook('REACH_BAZOOKA')).toBe('https://env/bazooka');
  });

  it('getEffective marks an overridden field and keeps others on env', async () => {
    const { service } = await make(ENV, { aimWebhookUrl: 'https://stored/aim' });
    const eff = await service.getEffective(ORG);
    expect(eff.webhooks.aim).toEqual({ value: 'https://stored/aim', overridden: true });
    expect(eff.webhooks.leadSatellite).toEqual({
      value: 'https://env/lead',
      overridden: false,
    });
  });

  it('a stored ingest-token hash flips ingestTokenSource to rotated', async () => {
    const { service } = await make(ENV, {
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
    const { service } = await make(ENV); // no stored row
    const eff = await service.getEffective(ORG);

    expect(eff.templates).toEqual({
      default: null,
      signature: null,
      signatureImageUrl: null,
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
    const { service } = await make(ENV, {
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
      signatureImageUrl: null,
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
    const { service } = await make(ENV);
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
    expect(await rowsOf(schema.orgConfig)).toHaveLength(1);
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
    const { service } = await make(ENV, {
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

describe('WorkflowConfigService — senders resolution', () => {
  it('getEffective falls back to DEFAULT_SENDERS when the org has none', async () => {
    const { service } = await make(ENV); // no org_senders rows
    const eff = await service.getEffective(ORG);
    expect(eff.senders).toEqual(DEFAULT_SENDERS);
    // The product default's flagged sender isn't authoritative for a fallback list,
    // but with no org pref the resolved default key is the first DEFAULT_SENDERS key.
    expect(eff.defaultSender).toBe('info');
  });

  it('getEffective surfaces the org rows + the flagged isDefault as the default key', async () => {
    const { service } = await make(ENV, undefined, [
      {
        organizationId: ORG,
        senderKey: 'sales',
        email: 'sales@acme.test',
        label: 'Sales',
        isDefault: false,
      },
      {
        organizationId: ORG,
        senderKey: 'ceo',
        email: 'ceo@acme.test',
        label: null,
        isDefault: true,
      },
    ]);
    const eff = await service.getEffective(ORG);
    expect(eff.senders).toEqual([
      { key: 'sales', email: 'sales@acme.test', label: 'Sales', isDefault: false },
      { key: 'ceo', email: 'ceo@acme.test', label: null, isDefault: true },
    ]);
    // The org's OWN flagged sender wins as the default key.
    expect(eff.defaultSender).toBe('ceo');
  });

  it('an explicit org_config.defaultSender wins over a DEFAULT_SENDERS flag (no org rows)', async () => {
    const { service } = await make(ENV, { defaultSender: 'hanna' }); // no org_senders
    const eff = await service.getEffective(ORG);
    expect(eff.senders).toEqual(DEFAULT_SENDERS);
    expect(eff.defaultSender).toBe('hanna');
  });

  it('getAutomation carries the resolved senders, the default sender EMAIL, and the calendar', async () => {
    const { service } = await make(ENV, { salesCalendarId: 'cal-org-1' }, [
      {
        organizationId: ORG,
        senderKey: 'ceo',
        email: 'ceo@acme.test',
        label: null,
        isDefault: true,
      },
    ]);
    const auto = await service.getAutomation(ORG);
    expect(auto.senders).toEqual([
      { key: 'ceo', email: 'ceo@acme.test', label: null, isDefault: true },
    ]);
    // n8n sets the From from this resolved EMAIL (the flagged default's address).
    expect(auto.defaultSenderEmail).toBe('ceo@acme.test');
    expect(auto.salesCalendarId).toBe('cal-org-1');
    // Templates + Leads still resolve identically to getEffective().
    expect(auto.templates).toEqual({
      default: null,
      signature: null,
      signatureImageUrl: null,
      tone: null,
      language: null,
    });
  });

  it('getAutomation default email falls back to DEFAULT_SENDERS when the org has none', async () => {
    const { service } = await make(ENV); // no org_senders, no org_config
    const auto = await service.getAutomation(ORG);
    expect(auto.senders).toEqual(DEFAULT_SENDERS);
    // info is the first DEFAULT_SENDERS entry → its email is the resolved From.
    expect(auto.defaultSenderEmail).toBe('info@evertrust-germany.de');
  });
});

describe('WorkflowConfigService — salesCalendarId resolution', () => {
  it('getEffective: org_config value wins over the env product default', async () => {
    const { service } = await make(
      { ...ENV, SALES_CALENDAR_ID: 'env-cal' },
      { salesCalendarId: 'org-cal' },
    );
    expect((await service.getEffective(ORG)).salesCalendarId).toBe('org-cal');
  });

  it('getEffective: falls back to the env SALES_CALENDAR_ID when org_config is unset', async () => {
    const { service } = await make({ ...ENV, SALES_CALENDAR_ID: 'env-cal' });
    expect((await service.getEffective(ORG)).salesCalendarId).toBe('env-cal');
  });

  it('getEffective: null when neither org_config nor env is set', async () => {
    const { service } = await make(ENV); // no SALES_CALENDAR_ID env
    expect((await service.getEffective(ORG)).salesCalendarId).toBeNull();
  });

  it('update: sets the per-org salesCalendarId, then null clears it back to env', async () => {
    const { service } = await make({ ...ENV, SALES_CALENDAR_ID: 'env-cal' });
    let eff = await service.update({ salesCalendarId: 'org-cal' }, ORG);
    expect(eff.salesCalendarId).toBe('org-cal');
    // It is a PER-ORG pref — lands on org_config, not the global singleton.
    expect(await rowsOf(schema.orgConfig)).toHaveLength(1);

    eff = await service.update({ salesCalendarId: null }, ORG);
    // Cleared → falls back to the env product default.
    expect(eff.salesCalendarId).toBe('env-cal');
  });
});

describe('WorkflowConfigService — sales timezones (raw per-org overrides)', () => {
  it('getEffective: surfaces stored zones verbatim; null when unset', async () => {
    const set = await make(ENV, {
      salesTimeZone: 'America/New_York',
      salesSecondaryTimeZone: 'Asia/Bangkok',
    });
    const eff = await set.service.getEffective(ORG);
    expect(eff.salesTimeZone).toBe('America/New_York');
    expect(eff.salesSecondaryTimeZone).toBe('Asia/Bangkok');

    // A different org with no stored prefs resolves both zones to null.
    const FRESH = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const effUnset = await set.service.getEffective(FRESH);
    expect(effUnset.salesTimeZone).toBeNull();
    expect(effUnset.salesSecondaryTimeZone).toBeNull();
  });

  it('update: sets both per-org zones, then null clears them back to the default', async () => {
    const { service } = await make(ENV);
    let eff = await service.update(
      { salesTimeZone: 'America/New_York', salesSecondaryTimeZone: 'Asia/Bangkok' },
      ORG,
    );
    expect(eff.salesTimeZone).toBe('America/New_York');
    expect(eff.salesSecondaryTimeZone).toBe('Asia/Bangkok');
    // Per-org prefs — land on org_config, not the global singleton.
    expect(await rowsOf(schema.orgConfig)).toHaveLength(1);

    eff = await service.update(
      { salesTimeZone: null, salesSecondaryTimeZone: null },
      ORG,
    );
    expect(eff.salesTimeZone).toBeNull();
    expect(eff.salesSecondaryTimeZone).toBeNull();
  });
});

describe('WorkflowConfigService — agent LLM resolution (org ?? env)', () => {
  const AGENT_ENV = {
    LLM_BASE_URL: 'https://env-gw/v1',
    EXTRACT_MODEL: 'hermes',
    LLM_API_KEY: 'env-secret',
  };

  it('resolveAgentLlm falls back to env when the org has no override', async () => {
    const { service } = await make(AGENT_ENV);
    expect(await service.resolveAgentLlm(ORG)).toEqual({
      baseUrl: 'https://env-gw/v1',
      model: 'hermes',
      apiKey: 'env-secret',
    });
  });

  it('a per-org gateway/model overrides env; key always comes from env', async () => {
    const { service } = await make(AGENT_ENV, {
      agentLlmBaseUrl: 'https://org-gw/v1',
      agentLlmModel: 'llama-3',
    });
    expect(await service.resolveAgentLlm(ORG)).toEqual({
      baseUrl: 'https://org-gw/v1',
      model: 'llama-3',
      apiKey: 'env-secret', // never per-org
    });
  });

  it('resolveAgentLlm(null) — global run — uses env defaults only', async () => {
    const { service } = await make(AGENT_ENV, {
      agentLlmBaseUrl: 'https://org-gw/v1',
    });
    expect(await service.resolveAgentLlm(null)).toEqual({
      baseUrl: 'https://env-gw/v1',
      model: 'hermes',
      apiKey: 'env-secret',
    });
  });

  it('getAiEngine surfaces the per-org agent fields', async () => {
    const { service } = await make(AGENT_ENV, {
      agentLlmBaseUrl: 'https://org-gw/v1',
      agentLlmModel: 'llama-3',
    });
    const cfg = await service.getAiEngine(ORG);
    expect(cfg.agentGateway).toBe('https://org-gw/v1');
    expect(cfg.agentModel).toBe('llama-3');
  });

  it('getAiEngine returns null agent fields when unset', async () => {
    const { service } = await make(AGENT_ENV);
    const cfg = await service.getAiEngine(ORG);
    expect(cfg.agentGateway).toBeNull();
    expect(cfg.agentModel).toBeNull();
  });

  it('updateAiEngine sets the per-org agent fields, then null clears them', async () => {
    const { service } = await make(AGENT_ENV);
    let cfg = await service.updateAiEngine(ORG, {
      agentGateway: 'https://org-gw/v1',
      agentModel: 'llama-3',
    });
    expect(cfg.agentGateway).toBe('https://org-gw/v1');
    expect(cfg.agentModel).toBe('llama-3');
    // Re-read confirms the write persisted on org_config(ORG).
    expect((await service.getAiEngine(ORG)).agentGateway).toBe('https://org-gw/v1');

    cfg = await service.updateAiEngine(ORG, {
      agentGateway: null,
      agentModel: null,
    });
    expect(cfg.agentGateway).toBeNull();
    expect(cfg.agentModel).toBeNull();
  });
});

describe('WorkflowConfigService — Lead Scraper config (org override ?? agent default)', () => {
  it('getLeadScraper returns null fields when unset (agent uses its env)', async () => {
    const { service } = await make({});
    expect(await service.getLeadScraper(ORG)).toEqual({
      leadTarget: null,
      maxQueries: null,
      minScore: null,
    });
  });

  it('getLeadScraper(null) — global run — returns all nulls', async () => {
    const { service } = await make({}, { scrapeLeadTarget: 20 });
    expect(await service.getLeadScraper(null)).toEqual({
      leadTarget: null,
      maxQueries: null,
      minScore: null,
    });
  });

  it('surfaces the per-org tuning when set', async () => {
    const { service } = await make({}, {
      scrapeLeadTarget: 20,
      scrapeMaxQueries: 40,
      scrapeMinScore: 55,
    });
    expect(await service.getLeadScraper(ORG)).toEqual({
      leadTarget: 20,
      maxQueries: 40,
      minScore: 55,
    });
  });

  it('updateLeadScraper sets the per-org tuning, then null clears it', async () => {
    const { service } = await make({});
    let cfg = await service.updateLeadScraper(ORG, {
      leadTarget: 25,
      maxQueries: 50,
      minScore: 60,
    });
    expect(cfg).toEqual({ leadTarget: 25, maxQueries: 50, minScore: 60 });
    // Re-read confirms persistence on org_config(ORG).
    expect((await service.getLeadScraper(ORG)).leadTarget).toBe(25);

    cfg = await service.updateLeadScraper(ORG, {
      leadTarget: null,
      maxQueries: null,
      minScore: null,
    });
    expect(cfg).toEqual({ leadTarget: null, maxQueries: null, minScore: null });
  });
});

describe('WorkflowConfigService.getLeadStats', () => {
  const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // Prospects require a NOT NULL campaign_id; FK enforcement is off in tests, so any
  // uuid satisfies the column without seeding a campaigns row.
  const CAMPAIGN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  // Seed leads/prospects/suppressions across two orgs; the count must be confined to
  // ORG (mirrors how the list endpoints scope via tenantScope/organizationId).
  async function makeStats() {
    await seed(schema.leads, [
      { organizationId: ORG, email: 'a@x.com' },
      { organizationId: ORG, email: 'b@x.com' },
      { organizationId: OTHER, email: 'c@x.com' }, // other org — excluded
    ]);
    await seed(schema.prospects, [
      { organizationId: ORG, campaignId: CAMPAIGN, email: 'd@x.com' },
      { organizationId: ORG, campaignId: CAMPAIGN, email: 'e@x.com' },
      { organizationId: ORG, campaignId: CAMPAIGN, email: 'f@x.com' },
    ]);
    await seed(schema.suppressions, [
      { organizationId: ORG, email: 'g@x.com' },
      { organizationId: OTHER, email: 'h@x.com' }, // other org — excluded
    ]);
    const db = getDb();
    return new WorkflowConfigService(
      db,
      makeConfig(ENV),
      new SendersService(db, fakeGoogleAccounts()),
    );
  }

  it('counts leads/prospects/suppressions scoped to the org', async () => {
    const service = await makeStats();
    const stats = await service.getLeadStats(ORG);
    expect(stats).toEqual({ leads: 2, prospects: 3, suppressed: 1 });
  });

  it('returns zeros for an org with no rows', async () => {
    const service = await makeStats();
    const stats = await service.getLeadStats(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    );
    expect(stats).toEqual({ leads: 0, prospects: 0, suppressed: 0 });
  });
});

describe('WorkflowConfigService — update (singleton upsert)', () => {
  it('creates the singleton when none exists and applies the override', async () => {
    const { service } = await make(ENV);
    const eff = await service.update({ webhooks: { aim: 'https://put/aim' } }, ORG);
    expect(await rowsOf(schema.workflowConfig)).toHaveLength(1);
    expect(eff.webhooks.aim).toEqual({ value: 'https://put/aim', overridden: true });
  });

  it('clears an override back to env when null is sent', async () => {
    const { service } = await make(ENV, { aimWebhookUrl: 'https://stored/aim' });
    const eff = await service.update({ webhooks: { aim: null } }, ORG);
    expect(eff.webhooks.aim).toEqual({ value: 'https://env/aim', overridden: false });
  });

  it('leaves omitted fields unchanged', async () => {
    const { service } = await make(ENV, {
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
    const { service } = await make(ENV);
    await service.update({ followupOffsetDays: 2 }, ORG);
    await service.update({ finalPushOffsetDays: 4 }, ORG);
    expect(await rowsOf(schema.workflowConfig)).toHaveLength(1);
    const eff = await service.getEffective(ORG);
    expect(eff.followupOffsetDays).toBe(2);
    expect(eff.finalPushOffsetDays).toBe(4);
  });
});

describe('WorkflowConfigService.rotateIngestToken', () => {
  it('returns a non-empty token and stores its SHA-256 hash (the guard would accept it)', async () => {
    const { service } = await make(ENV);
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
    const { service } = await make(ENV);
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
    const { service } = await make(ENV);
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

    const { service } = await make({}); // no N8N_API_URL / N8N_API_KEY
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

    const { service } = await make({ N8N_API_URL: 'https://n8n.test', N8N_API_KEY: 'k' });
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

    const { service } = await make({ N8N_API_URL: 'https://n8n.test', N8N_API_KEY: 'k' });
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

    const { service } = await make({ N8N_API_URL: 'https://n8n.test', N8N_API_KEY: 'k' });
    const res = await service.testN8nConnection();
    expect(res.ok).toBe(false);
    expect(res.configured).toBe(true);
    expect(res.detail).toBe('ECONNREFUSED');
    expect(res.workflowCount).toBeNull();
  });
});
