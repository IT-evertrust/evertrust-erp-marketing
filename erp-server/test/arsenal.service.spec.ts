import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ArsenalService } from '../src/arsenal/arsenal.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, makeWorkflowConfig, rowsOf, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const NICHE_LED = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const BAZOOKA_URL = 'https://evertrustgmbh.app.n8n.cloud/webhook/bazooka';
const LEAD_URL = 'https://evertrustgmbh.app.n8n.cloud/webhook/wf03-lead-research';

function makeConfig(urls: Record<string, string>): AppConfigService {
  return { get: (k: string) => urls[k] ?? '' } as unknown as AppConfigService;
}

// Seeds the campaign + niche graph against the real db, then builds an
// ArsenalService over the shared client. Async — every call site awaits it.
async function setup(urls: Record<string, string> = {}) {
  await seed(schema.campaigns, [
    {
      id: C_A,
      organizationId: ORG_A,
      name: null,
      nicheId: NICHE_LED,
      country: 'Germany',
      region: 'North',
      project: 'LED Retrofit Berlin 2026',
      gmailLabel: 'LED-Berlin-2026',
      salesCalendarId: 'info@evertrust-germany.de',
      whatsappNumber: '+4915112345678',
      sender: 'info',
      lifecycle: 'ACTIVE',
      driveFolderId: 'F1',
      driveFolderUrl: 'https://drive/F1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ]);
  // campaignPayload resolves the niche NAME from the campaign's nicheId.
  await seed(schema.niches, [
    { id: NICHE_LED, organizationId: ORG_A, name: 'LED', slug: 'led' },
  ]);
  const db = getDb();
  const config = makeConfig(urls);
  return { service: new ArsenalService(db, makeWorkflowConfig(db, config)) };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ArsenalService — run (manual triggers)', () => {
  // WHY: a GLOBAL stage (Bazooka) hits its webhook with no campaign and the
  // hand-off is recorded DISPATCHED. The recorded run is the operator's proof.
  it('fires a GLOBAL stage webhook and records DISPATCHED (no campaign)', async () => {
    const { service } = await setup({ N8N_REACH_BAZOOKA_WEBHOOK_URL: BAZOOKA_URL });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const run = await service.run(ORG_A, 'REACH_BAZOOKA', {
      source: 'MANUAL',
      userId: USER,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(BAZOOKA_URL);
    expect(run.stage).toBe('REACH_BAZOOKA');
    expect(run.status).toBe('DISPATCHED');
    expect(run.campaignId).toBeFalsy();
    expect(run.organizationId).toBe(ORG_A);
    expect(run.source).toBe('MANUAL');
    expect(run.triggeredBy).toBe(USER);
  });

  // WHY: a stage with no webhook configured must fail LOUD (400) and record
  // nothing — there's nothing to dispatch. Defends the UI's disabled state.
  it('rejects an unconfigured stage and records no run', async () => {
    const { service } = await setup({});
    await expect(
      service.run(ORG_A, 'REACH_BAZOOKA', { source: 'MANUAL' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await rowsOf(schema.arsenalRuns)).toHaveLength(0);
  });

  // WHY: from the Arsenal panel, a PER_CAMPAIGN stage runs GLOBALLY (no campaign)
  // — it must NOT require a campaignId; it fires with no campaign context.
  it('runs a PER_CAMPAIGN stage globally when no campaign is given', async () => {
    const { service } = await setup({ N8N_LEAD_SATELLITE_WEBHOOK_URL: LEAD_URL });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const run = await service.run(ORG_A, 'LEAD_SATELLITE', { source: 'MANUAL' });

    expect(run.status).toBe('DISPATCHED');
    expect(run.campaignId).toBeFalsy();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toMatchObject({
      stage: 'LEAD_SATELLITE',
      source: 'erp',
    });
  });

  // WHY: the Reply Glock / Sleeper n8n webhooks are GET — POSTing to them 404s, so
  // a GET-method stage must be fired with GET and no body.
  it('fires a GET-webhook stage with GET and no body', async () => {
    const { service } = await setup({
      N8N_REPLY_GLOCK_WEBHOOK_URL: 'https://n8n/webhook/wf6-reply-glock',
    });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const run = await service.run(ORG_A, 'REPLY_GLOCK', { source: 'MANUAL' });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://n8n/webhook/wf6-reply-glock');
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
    expect(run.status).toBe('DISPATCHED');
  });

  // WHY: a PER_CAMPAIGN stage must carry THAT campaign's context to n8n and tie
  // the run to the campaign.
  it('fires a PER_CAMPAIGN stage with campaign context + records the campaignId', async () => {
    const { service } = await setup({ N8N_LEAD_SATELLITE_WEBHOOK_URL: LEAD_URL });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const run = await service.run(ORG_A, 'LEAD_SATELLITE', {
      campaignId: C_A,
      source: 'MANUAL',
      userId: USER,
    });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LEAD_URL);
    expect(JSON.parse(opts.body as string)).toMatchObject({
      stage: 'LEAD_SATELLITE',
      campaign: { campaignId: C_A, niche: 'LED', driveFolderUrl: 'https://drive/F1' },
    });
    expect(run.campaignId).toBe(C_A);
    expect(run.status).toBe('DISPATCHED');
  });

  it('404s a PER_CAMPAIGN run against another org’s campaign', async () => {
    const { service } = await setup({ N8N_LEAD_SATELLITE_WEBHOOK_URL: LEAD_URL });
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    await expect(
      service.run(ORG_B, 'LEAD_SATELLITE', { campaignId: C_A, source: 'MANUAL' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records FAILED on a non-2xx webhook response', async () => {
    const { service } = await setup({ N8N_REACH_BAZOOKA_WEBHOOK_URL: BAZOOKA_URL });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 502 }) as unknown as typeof fetch;
    const run = await service.run(ORG_A, 'REACH_BAZOOKA', { source: 'MANUAL' });
    expect(run.status).toBe('FAILED');
    expect(run.detail).toContain('502');
  });
});

describe('ArsenalService — listRuns', () => {
  // WHY: runs are visible to the initiating org PLUS global (scheduled, null-org)
  // runs — but never another org's.
  it('returns org runs + global runs, excludes other orgs', async () => {
    const { service } = await setup({
      N8N_REACH_BAZOOKA_WEBHOOK_URL: BAZOOKA_URL,
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    await service.run(ORG_A, 'REACH_BAZOOKA', { source: 'MANUAL', userId: USER });
    await service.run(null, 'REACH_BAZOOKA', { source: 'SCHEDULED' }); // global
    await seed(schema.arsenalRuns, [
      {
        organizationId: ORG_B,
        stage: 'REACH_BAZOOKA',
        campaignId: null,
        source: 'MANUAL',
        status: 'DISPATCHED',
        detail: null,
        triggeredBy: null,
      },
    ]);

    const orgs = (await service.listRuns(ORG_A)).map((r) => r.organizationId);
    expect(orgs).toContain(ORG_A);
    expect(orgs).toContain(null);
    expect(orgs).not.toContain(ORG_B);
  });
});

describe('ArsenalService — recordCallback (n8n→ERP writeback)', () => {
  // WHY: an autonomous n8n run posts back by ERP campaignId → it's recorded as a
  // source=N8N run tied to that campaign + its org (so the per-campaign feed shows
  // it). This is the whole point of the writeback.
  it('records a SUCCESS callback by campaignId, attributed to the campaign + org', async () => {
    const { service } = await setup();
    const { id } = await service.recordCallback({
      stage: 'LEAD_SATELLITE',
      status: 'SUCCESS',
      campaignId: C_A,
      detail: '12 leads scraped',
    });
    const row = (await rowsOf(schema.arsenalRuns)).find((r) => r.id === id);
    expect(row).toMatchObject({
      stage: 'LEAD_SATELLITE',
      status: 'SUCCESS',
      source: 'N8N',
      campaignId: C_A,
      organizationId: ORG_A,
      detail: '12 leads scraped',
      triggeredBy: null,
    });
  });

  // WHY: n8n knows its Drive folder id natively (it reads config from it) but not
  // the ERP UUID — resolving by driveFolderId is what makes the writeback practical
  // for the autonomous Drive-poll stages.
  it('resolves the campaign by driveFolderId when no campaignId is given', async () => {
    const { service } = await setup();
    const { id } = await service.recordCallback({
      stage: 'AMMO_FORGE',
      status: 'ERROR',
      driveFolderId: 'F1',
      detail: 'OpenAI rate limited',
    });
    const row = (await rowsOf(schema.arsenalRuns)).find((r) => r.id === id);
    expect(row).toMatchObject({
      stage: 'AMMO_FORGE',
      status: 'ERROR',
      source: 'N8N',
      campaignId: C_A,
      organizationId: ORG_A,
    });
  });

  // WHY: a global stage (Bazooka/Glock/Sleeper) carries no campaign — the callback
  // records it with null org + campaign, like the SCHEDULED global runs.
  it('records a global callback (no campaign) with null org + campaign', async () => {
    const { service } = await setup();
    const { id } = await service.recordCallback({
      stage: 'REACH_BAZOOKA',
      status: 'SUCCESS',
    });
    const row = (await rowsOf(schema.arsenalRuns)).find((r) => r.id === id);
    expect(row).toMatchObject({
      stage: 'REACH_BAZOOKA',
      status: 'SUCCESS',
      source: 'N8N',
      campaignId: null,
      organizationId: null,
    });
  });

  // WHY: an unknown campaignId / driveFolderId must 404 (not silently record an
  // orphan run) — a mis-wired n8n workflow should fail loud, not pollute the feed.
  it('404s an unknown campaignId and records nothing', async () => {
    const { service } = await setup();
    await expect(
      service.recordCallback({
        stage: 'LEAD_SATELLITE',
        status: 'SUCCESS',
        campaignId: '99999999-9999-9999-9999-999999999999',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await rowsOf(schema.arsenalRuns)).toHaveLength(0);
  });

  it('404s an unknown driveFolderId and records nothing', async () => {
    const { service } = await setup();
    await expect(
      service.recordCallback({
        stage: 'AMMO_FORGE',
        status: 'SUCCESS',
        driveFolderId: 'does-not-exist',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await rowsOf(schema.arsenalRuns)).toHaveLength(0);
  });

  // WHY: a callback-recorded run is visible to the campaign's org in listRuns,
  // proving it reaches the per-campaign Live activity feed end-to-end.
  it('surfaces callback runs to the org via listRuns', async () => {
    const { service } = await setup();
    await service.recordCallback({
      stage: 'LEAD_SATELLITE',
      status: 'SUCCESS',
      campaignId: C_A,
    });
    const runs = await service.listRuns(ORG_A);
    expect(runs.some((r) => r.source === 'N8N' && r.campaignId === C_A)).toBe(true);
  });
});

// Build an arsenal_runs row at `at` (defaults to now, so it lands in the latest
// bucket of any period window) for the report tests.
function runRow(o: {
  stage: string;
  status: string;
  org: string | null;
  campaign?: string | null;
  metrics?: Record<string, number>;
  at?: Date;
}) {
  return {
    id: randomUUID(),
    organizationId: o.org,
    stage: o.stage,
    campaignId: o.campaign ?? null,
    source: 'N8N',
    status: o.status,
    detail: null,
    metrics: o.metrics ?? null,
    triggeredBy: null,
    createdAt: o.at ?? new Date(),
  };
}

describe('ArsenalService — getReport (Marketing report)', () => {
  // WHY: per-stage health (runs/ok/errors/successRate/trend) comes straight from
  // arsenal_runs in the window. DISPATCHED+SUCCESS count as ok; ERROR as error.
  it('aggregates per-stage health for runs in the window', async () => {
    const { service } = await setup();
    await seed(schema.arsenalRuns, [
      runRow({ stage: 'LEAD_SATELLITE', status: 'SUCCESS', org: ORG_A }),
      runRow({ stage: 'LEAD_SATELLITE', status: 'DISPATCHED', org: ORG_A }),
      runRow({ stage: 'LEAD_SATELLITE', status: 'ERROR', org: ORG_A }),
    ]);
    const report = await service.getReport(ORG_A, 'week');
    expect(report.buckets).toHaveLength(7); // last 7 days, one bucket per day
    expect(report.kpis.totalRuns).toBe(3);
    const lead = report.stages.find((s) => s.stage === 'LEAD_SATELLITE')!;
    expect(lead.runs).toBe(3);
    expect(lead.ok).toBe(2);
    expect(lead.errors).toBe(1);
    expect(lead.successRate).toBeCloseTo(2 / 3);
    // newest runs land in the last bucket
    expect(lead.trend[lead.trend.length - 1]).toBe(3);
  });

  // WHY: the funnel is null ("awaiting n8n") until a run reports that metric, then
  // it sums. This is the whole phased-design contract.
  it('funnel/meetings are null until metrics are reported, then sum', async () => {
    const { service } = await setup();
    await seed(schema.arsenalRuns, [
      runRow({ stage: 'REACH_BAZOOKA', status: 'SUCCESS', org: ORG_A }),
    ]);
    let report = await service.getReport(ORG_A, 'week');
    expect(report.funnel.emailsSent).toBeNull();
    expect(report.funnel.meetingsBooked).toBeNull();
    expect(report.kpis.meetingsBooked).toBeNull();

    await seed(schema.arsenalRuns, [
      runRow({
        stage: 'REACH_BAZOOKA',
        status: 'SUCCESS',
        org: ORG_A,
        metrics: { emailsSent: 40 },
      }),
      runRow({
        stage: 'REPLY_GLOCK',
        status: 'SUCCESS',
        org: ORG_A,
        metrics: { meetingsBooked: 3, repliesHandled: 9 },
      }),
    ]);
    report = await service.getReport(ORG_A, 'week');
    expect(report.funnel.emailsSent).toBe(40);
    expect(report.funnel.repliesHandled).toBe(9);
    expect(report.funnel.meetingsBooked).toBe(3);
    expect(report.kpis.meetingsBooked).toBe(3);
    const bazooka = report.stages.find((s) => s.stage === 'REACH_BAZOOKA')!;
    expect(bazooka.metrics.emailsSent).toBe(40);
  });

  // WHY: only the caller's org (+ global null-org runs) and only the window count.
  it('excludes other orgs and out-of-window runs; includes global runs', async () => {
    const { service } = await setup();
    await seed(schema.arsenalRuns, [
      runRow({ stage: 'LEAD_SATELLITE', status: 'SUCCESS', org: ORG_A, at: new Date('2024-01-01T00:00:00Z') }),
      runRow({ stage: 'LEAD_SATELLITE', status: 'SUCCESS', org: ORG_B }),
      runRow({ stage: 'REACH_BAZOOKA', status: 'SUCCESS', org: null }),
    ]);
    const report = await service.getReport(ORG_A, 'day');
    expect(report.kpis.totalRuns).toBe(1); // only the recent global run
  });

  // WHY: scoping to a campaign counts only its runs; global-stage runs (campaignId
  // null) drop out. The echoed campaignId confirms the scope.
  it('scopes to one campaign when campaignId is given', async () => {
    const { service } = await setup();
    await seed(schema.arsenalRuns, [
      runRow({
        stage: 'LEAD_SATELLITE',
        status: 'SUCCESS',
        org: ORG_A,
        campaign: C_A,
        metrics: { leadsFound: 5 },
      }),
      runRow({ stage: 'REACH_BAZOOKA', status: 'SUCCESS', org: ORG_A }), // global, no campaign
    ]);
    const report = await service.getReport(ORG_A, 'week', C_A);
    expect(report.campaignId).toBe(C_A);
    expect(report.kpis.totalRuns).toBe(1); // only the campaign-tagged run
    expect(report.funnel.leadsFound).toBe(5);
    const bazooka = report.stages.find((s) => s.stage === 'REACH_BAZOOKA')!;
    expect(bazooka.runs).toBe(0);
  });

  // WHY: rolling windows — day = last 24h (hourly bars), week = last 7 days,
  // month = last 30 days (daily bars).
  it('uses rolling windows: day=24 hourly, week=7 daily, month=30 daily buckets', async () => {
    const { service } = await setup();
    expect((await service.getReport(ORG_A, 'day')).buckets).toHaveLength(24);
    expect((await service.getReport(ORG_A, 'week')).buckets).toHaveLength(7);
    expect((await service.getReport(ORG_A, 'month')).buckets).toHaveLength(30);
  });

  it('empty window → zero runs, null rates, null funnel', async () => {
    const { service } = await setup();
    const report = await service.getReport(ORG_A, 'week');
    expect(report.kpis.totalRuns).toBe(0);
    expect(report.kpis.successRate).toBeNull();
    expect(report.funnel.leadsFound).toBeNull();
    expect(report.stages).toHaveLength(5);
    expect(report.stages.every((s) => s.runs === 0)).toBe(true);
  });
});

describe('ArsenalService — recordCallback stores metrics', () => {
  it('persists the metrics map on the N8N run', async () => {
    const { service } = await setup();
    const { id } = await service.recordCallback({
      stage: 'REACH_BAZOOKA',
      status: 'SUCCESS',
      metrics: { emailsSent: 12 },
    });
    const row = (await rowsOf(schema.arsenalRuns)).find((r) => r.id === id);
    expect(row?.metrics).toEqual({ emailsSent: 12 });
  });
});

describe('ArsenalService — clearRuns (test-data reset)', () => {
  it('deletes the org runs (+ global), keeps other orgs', async () => {
    const { service } = await setup();
    await seed(schema.arsenalRuns, [
      runRow({ stage: 'LEAD_SATELLITE', status: 'SUCCESS', org: ORG_A }),
      runRow({ stage: 'REACH_BAZOOKA', status: 'SUCCESS', org: ORG_A }),
      runRow({ stage: 'REACH_BAZOOKA', status: 'SUCCESS', org: ORG_B }),
    ]);
    const deleted = await service.clearRuns(ORG_A);
    expect(deleted).toBe(2);
    expect((await rowsOf(schema.arsenalRuns)).map((r) => r.organizationId)).toEqual([
      ORG_B,
    ]);
  });
});

describe('ArsenalService — settings (editable daily time + timezone)', () => {
  // WHY: the daily Bazooka time + zone are ERP-editable settings, not env config.
  // They default off, upsert in place, and are org-scoped.
  it('defaults to no daily time/zone when unset', async () => {
    const { service } = await setup();
    expect(await service.getSettings(ORG_A)).toEqual({
      bazookaDailyAt: null,
      bazookaTimezone: null,
    });
  });

  it('upserts then reads back the time + zone, scoped to the org', async () => {
    const { service } = await setup();
    await service.updateSettings(
      ORG_A,
      { bazookaDailyAt: '08:30', bazookaTimezone: 'Europe/Berlin' },
      USER,
    );
    expect(await service.getSettings(ORG_A)).toEqual({
      bazookaDailyAt: '08:30',
      bazookaTimezone: 'Europe/Berlin',
    });
    // editing again updates in place (no duplicate row) — incl. the zone
    await service.updateSettings(
      ORG_A,
      { bazookaDailyAt: '09:15', bazookaTimezone: 'UTC' },
      USER,
    );
    expect(await service.getSettings(ORG_A)).toEqual({
      bazookaDailyAt: '09:15',
      bazookaTimezone: 'UTC',
    });
    // another org is unaffected
    expect(await service.getSettings(ORG_B)).toEqual({
      bazookaDailyAt: null,
      bazookaTimezone: null,
    });
  });

  it('clears the daily time but keeps the zone (null = off)', async () => {
    const { service } = await setup();
    await service.updateSettings(
      ORG_A,
      { bazookaDailyAt: '08:00', bazookaTimezone: 'Europe/Berlin' },
      USER,
    );
    await service.updateSettings(
      ORG_A,
      { bazookaDailyAt: null, bazookaTimezone: 'Europe/Berlin' },
      USER,
    );
    expect(await service.getSettings(ORG_A)).toEqual({
      bazookaDailyAt: null,
      bazookaTimezone: 'Europe/Berlin',
    });
  });

  it('surfaces the saved time + zone to the scheduler boot query', async () => {
    const { service } = await setup();
    await service.updateSettings(
      ORG_A,
      { bazookaDailyAt: '08:00', bazookaTimezone: 'Europe/Vienna' },
      USER,
    );
    expect(await service.settingsWithDailyTime()).toEqual([
      {
        organizationId: ORG_A,
        bazookaDailyAt: '08:00',
        bazookaTimezone: 'Europe/Vienna',
      },
    ]);
  });
});
