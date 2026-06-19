import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  ARSENAL_STAGE_META,
  isArsenalRunOk,
  type ArsenalRunSource,
  type ArsenalStage,
  type MarketingReportDto,
  type MarketingReportPeriod,
  type MarketingStageReportDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { driveFolderUrl, writeMachineAudit } from '../common/machine-audit';
import type { Env } from '../config/env.schema';
import { WorkflowConfigService } from './workflow-config.service';

type CampaignRow = typeof schema.campaigns.$inferSelect;
type ArsenalRunRow = typeof schema.arsenalRuns.$inferSelect;

// ArsenalStage → the env var holding that stage's n8n webhook URL. The effective
// URL now resolves through WorkflowConfigService (stored override ?? env); this map
// only names the env var for the "not wired up" operator hint. `as const satisfies`
// keeps the literal key types while checking every value is a real Env key.
const STAGE_WEBHOOK_ENV = {
  LEAD_SATELLITE: 'N8N_LEAD_SATELLITE_WEBHOOK_URL',
  AMMO_FORGE: 'N8N_AMMO_FORGE_WEBHOOK_URL',
  REACH_BAZOOKA: 'N8N_REACH_BAZOOKA_WEBHOOK_URL',
  REPLY_GLOCK: 'N8N_REPLY_GLOCK_WEBHOOK_URL',
  SLEEPER_GRENADE: 'N8N_SLEEPER_GRENADE_WEBHOOK_URL',
} as const satisfies Record<ArsenalStage, keyof Env>;

// The HTTP method each stage's n8n webhook listens on. n8n registers a webhook
// per method+path, so POSTing to a GET-only webhook returns 404. The existing
// Reply Glock / Sleeper manual webhooks are GET ("Workflow got started"); AIM /
// Lead Satellite / Ammo Forge are POST. Bazooka has no webhook yet (GET to match
// the others' pattern once one is added).
const STAGE_METHOD: Record<ArsenalStage, 'GET' | 'POST'> = {
  LEAD_SATELLITE: 'POST',
  AMMO_FORGE: 'POST',
  REACH_BAZOOKA: 'GET',
  REPLY_GLOCK: 'GET',
  SLEEPER_GRENADE: 'GET',
};

// ArsenalStage → the Python-agent run path (POST), used when the stage's
// AGENT_*_URL is configured (the ERP-native dispatch path).
const STAGE_AGENT_PATH: Record<ArsenalStage, string> = {
  LEAD_SATELLITE: '/satellite/run',
  AMMO_FORGE: '/ammoforge/run',
  REACH_BAZOOKA: '/reach/run',
  REPLY_GLOCK: '/glock/run',
  SLEEPER_GRENADE: '/sleeper/run',
};

// Fires an arsenal stage's n8n webhook ("Run now" + the daily scheduler) and
// records the hand-off in arsenal_runs. ERP-first + observable: the webhook call
// is best-effort and the ERP owns only the hand-off (DISPATCHED) — n8n then runs
// async. The run row is written for BOTH success and failure so every trigger is
// visible. A non-2xx / network error records FAILED rather than 500-ing.
@Injectable()
export class ArsenalService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly workflowConfig: WorkflowConfigService,
  ) {}

  // Recent arsenal runs visible to the caller's org PLUS global (scheduled) runs,
  // which carry no org. Newest-first, capped. (Low volume; filtered in-process to
  // keep the org-OR-null scope simple.)
  async listRuns(orgId: string): Promise<ArsenalRunRow[]> {
    const rows = await this.db
      .select()
      .from(schema.arsenalRuns)
      .orderBy(desc(schema.arsenalRuns.createdAt));
    return rows
      .filter((r) => r.organizationId === orgId || r.organizationId === null)
      .slice(0, 50);
  }

  // Clear the run feed (test-data reset): deletes the org's arsenal_runs PLUS the
  // global (null-org) scheduled runs that show in its Live activity. Returns the
  // count removed.
  async clearRuns(orgId: string): Promise<number> {
    const all = await this.db.select().from(schema.arsenalRuns);
    const count = all.filter(
      (r) => r.organizationId === orgId || r.organizationId === null,
    ).length;
    await this.db
      .delete(schema.arsenalRuns)
      .where(eq(schema.arsenalRuns.organizationId, orgId));
    await this.db
      .delete(schema.arsenalRuns)
      .where(isNull(schema.arsenalRuns.organizationId));
    return count;
  }

  // The org's Growth-Engine settings (the editable daily Bazooka time + timezone).
  // Defaults to off (null) when no row exists yet.
  async getSettings(
    orgId: string,
  ): Promise<{ bazookaDailyAt: string | null; bazookaTimezone: string | null }> {
    const rows = await this.db
      .select()
      .from(schema.arsenalSettings)
      .where(eq(schema.arsenalSettings.organizationId, orgId))
      .limit(1);
    return {
      bazookaDailyAt: rows[0]?.bazookaDailyAt ?? null,
      bazookaTimezone: rows[0]?.bazookaTimezone ?? null,
    };
  }

  // Upsert the org's daily Bazooka time + timezone (time null = off). Returns the
  // saved values.
  async updateSettings(
    orgId: string,
    input: { bazookaDailyAt: string | null; bazookaTimezone: string | null },
    userId: string,
  ): Promise<{ bazookaDailyAt: string | null; bazookaTimezone: string | null }> {
    const { bazookaDailyAt, bazookaTimezone } = input;
    const existing = await this.db
      .select()
      .from(schema.arsenalSettings)
      .where(eq(schema.arsenalSettings.organizationId, orgId))
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(schema.arsenalSettings)
        .set({
          bazookaDailyAt,
          bazookaTimezone,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.arsenalSettings.id, existing[0].id));
    } else {
      await this.db.insert(schema.arsenalSettings).values({
        organizationId: orgId,
        bazookaDailyAt,
        bazookaTimezone,
        updatedBy: userId,
      });
    }
    return { bazookaDailyAt, bazookaTimezone };
  }

  // Every org that has a daily Bazooka time set — the scheduler arms one timer per
  // row on boot (each interpreted in its saved timezone).
  async settingsWithDailyTime(): Promise<
    {
      organizationId: string;
      bazookaDailyAt: string;
      bazookaTimezone: string | null;
    }[]
  > {
    const rows = await this.db
      .select()
      .from(schema.arsenalSettings)
      .where(isNotNull(schema.arsenalSettings.bazookaDailyAt));
    return rows
      .filter((r) => r.bazookaDailyAt !== null)
      .map((r) => ({
        organizationId: r.organizationId,
        bazookaDailyAt: r.bazookaDailyAt as string,
        bazookaTimezone: r.bazookaTimezone ?? null,
      }));
  }

  // Fire a stage. PER_CAMPAIGN stages require a campaignId (and send that
  // campaign's context); GLOBAL stages take none. orgId is null only for the
  // scheduler's GLOBAL runs. 400 if the stage isn't configured / a PER_CAMPAIGN
  // stage is missing its campaign; 404 if the campaign is cross-org.
  async run(
    orgId: string | null,
    stage: ArsenalStage,
    opts: { campaignId?: string; source: ArsenalRunSource; userId?: string | null },
  ): Promise<ArsenalRunRow> {
    const meta = ARSENAL_STAGE_META[stage];
    let campaignId: string | null = null;
    let campaignName: string | null = null;
    let payload: Record<string, unknown>;

    // A campaign was chosen (a targeted run from a campaign) → send that
    // campaign's context. Otherwise it's a global run (e.g. the Arsenal panel) —
    // fire the stage with no campaign; the worker processes across campaigns.
    if (opts.campaignId) {
      if (!orgId) {
        throw new BadRequestException('A campaign-scoped run needs a tenant.');
      }
      const campaign = await this.requireCampaign(orgId, opts.campaignId);
      campaignId = campaign.id;
      campaignName = campaign.name;
      payload = { stage, campaign: await this.campaignPayload(campaign) };
    } else {
      payload = { stage, source: 'erp' };
    }

    // ERP-native Python agent takes precedence when its AGENT_*_URL is set;
    // otherwise fall back to the stage's n8n webhook. Either way a run row is
    // written; the agent/n8n then posts its final outcome to /arsenal/runs/callback.
    const agentUrl = this.workflowConfig.getStageAgentUrl(stage);
    let outcome: { status: 'DISPATCHED' | 'FAILED'; detail: string };
    if (agentUrl) {
      // Resolve the org's agent-LLM config (org_config ?? env) and hand it to the
      // agent in the dispatch body, so the AI Engine page drives which gateway/model
      // the Python agent uses, per tenant. The API key travels server-to-server only.
      const llm = await this.workflowConfig.resolveAgentLlm(orgId);
      // Per-org Lead Scraper tuning (Configuration page → agent). Null fields are
      // omitted so the agent keeps its own env default (request value ?? agent env).
      const scraper = await this.workflowConfig.getLeadScraper(orgId);
      outcome = await this.fireAgent(agentUrl, stage, {
        campaignId,
        campaign: campaignName,
        llm,
        scraper,
      });
    } else {
      const webhookUrl = await this.workflowConfig.getStageWebhook(stage);
      if (!webhookUrl) {
        throw new BadRequestException(
          `${meta.label} is not wired up yet — set ${STAGE_WEBHOOK_ENV[stage]} (n8n) or its AGENT_*_URL (Python agent).`,
        );
      }
      outcome = await this.fire(webhookUrl, STAGE_METHOD[stage], payload);
    }

    const inserted = await this.db
      .insert(schema.arsenalRuns)
      .values({
        organizationId: orgId,
        stage,
        campaignId,
        source: opts.source,
        status: outcome.status,
        detail: outcome.detail,
        triggeredBy: opts.userId ?? null,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to record arsenal run');
    return row;
  }

  // Record an autonomous n8n run reported back via the callback (source N8N). This
  // is the n8n→ERP writeback: n8n runs a stage on its own schedule / Drive poll and
  // POSTs the FINAL outcome here so it shows in the per-campaign Live activity feed.
  // The campaign (and its org) is resolved from the ERP campaignId OR the Drive
  // folder id n8n knows natively; neither given = a global stage (org/campaign null).
  // No JWT here — the controller gates this on the shared ingest token. Cross-org
  // by design: the token is the trust boundary; the run is attributed to the
  // campaign's own org. 404 if a given campaignId / driveFolderId matches nothing.
  async recordCallback(input: {
    stage: ArsenalStage;
    status: 'SUCCESS' | 'ERROR';
    campaignId?: string;
    driveFolderId?: string;
    detail?: string;
    metrics?: Record<string, number>;
  }): Promise<{ id: string }> {
    let campaign: CampaignRow | null = null;
    if (input.campaignId) {
      const rows = await this.db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, input.campaignId))
        .limit(1);
      campaign = rows[0] ?? null;
      if (!campaign) {
        throw new NotFoundException(
          `No campaign for campaignId ${input.campaignId}`,
        );
      }
    } else if (input.driveFolderId) {
      const rows = await this.db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.driveFolderId, input.driveFolderId))
        .limit(1);
      campaign = rows[0] ?? null;
      if (!campaign) {
        throw new NotFoundException(
          `No campaign for driveFolderId ${input.driveFolderId}`,
        );
      }
    }

    // Persist the Ammo Forge folder when n8n discloses it for a known campaign that
    // doesn't have one yet (the new AIM webhook no longer returns Drive refs at
    // launch, so this is how a campaign acquires its artifact folder lazily).
    if (
      campaign &&
      input.campaignId &&
      input.driveFolderId &&
      campaign.driveFolderId !== input.driveFolderId
    ) {
      const updated = await this.db
        .update(schema.campaigns)
        .set({
          driveFolderId: input.driveFolderId,
          driveFolderUrl: driveFolderUrl(input.driveFolderId),
        })
        .where(eq(schema.campaigns.id, campaign.id))
        .returning();
      campaign = updated[0] ?? campaign;
    }

    const inserted = await this.db
      .insert(schema.arsenalRuns)
      .values({
        organizationId: campaign?.organizationId ?? null,
        stage: input.stage,
        campaignId: campaign?.id ?? null,
        source: 'N8N',
        status: input.status,
        detail: input.detail ?? null,
        metrics: input.metrics ?? null,
        triggeredBy: null,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to record arsenal callback');

    // Machine writes are audited with actorType N8N (mirrors the doctrine path for
    // n8n→ERP writebacks). Org-scoped runs only — a global stage has no org to
    // satisfy audit_log.organization_id NOT NULL.
    if (campaign) {
      await writeMachineAudit(this.db, {
        organizationId: campaign.organizationId,
        entity: 'arsenal_runs',
        entityId: row.id,
        action: 'CALLBACK',
        after: {
          stage: input.stage,
          status: input.status,
          campaignId: campaign.id,
          driveFolderId: input.driveFolderId ?? null,
          metrics: input.metrics ?? null,
        },
      });
    }

    return { id: row.id };
  }

  // ----- Marketing report --------------------------------------------------

  // The Growth-Engine sequence report for a period (day/week/month). Aggregates
  // the org's runs (+ global null-org runs) into per-stage health (runs, ok/error,
  // trend) + funnel metric sums (null until n8n reports them). Low volume → fetch
  // all + window-filter in JS (mirrors listRuns).
  async getReport(
    orgId: string,
    period: MarketingReportPeriod,
    campaignId?: string,
  ): Promise<MarketingReportDto> {
    const now = new Date();
    const { from, labels, indexOf, count } = this.buildBuckets(period, now);

    const allRuns = await this.db.select().from(schema.arsenalRuns);
    // Org (+ global null-org) runs in the window. When scoped to a campaign, only
    // runs tagged with it — global-stage runs (campaignId null) drop out, which is
    // honest: they aren't attributed to a campaign until reported per loop-iteration.
    const runs = allRuns.filter(
      (r) =>
        (r.organizationId === orgId || r.organizationId === null) &&
        (!campaignId || r.campaignId === campaignId) &&
        indexOf(new Date(r.createdAt)) >= 0,
    );

    const stages: MarketingStageReportDto[] = (
      Object.keys(ARSENAL_STAGE_META) as ArsenalStage[]
    ).map((stage) => {
      const stageRuns = runs.filter((r) => r.stage === stage);
      const ok = stageRuns.filter((r) => isArsenalRunOk(r.status)).length;
      const trend = new Array<number>(count).fill(0);
      const metrics: Record<string, number> = {};
      for (const r of stageRuns) {
        const idx = indexOf(new Date(r.createdAt));
        if (idx >= 0) trend[idx] = (trend[idx] ?? 0) + 1;
        const m = r.metrics;
        if (m) {
          for (const [k, v] of Object.entries(m)) {
            if (typeof v === 'number' && Number.isFinite(v)) {
              metrics[k] = (metrics[k] ?? 0) + v;
            }
          }
        }
      }
      return {
        stage,
        runs: stageRuns.length,
        ok,
        errors: stageRuns.length - ok,
        successRate: stageRuns.length ? ok / stageRuns.length : null,
        metrics,
        trend,
      };
    });

    // Funnel: sum across all runs; null when no run carried that key (= awaiting n8n).
    const FUNNEL_KEYS = [
      'leadsFound',
      'emailsSent',
      'repliesHandled',
      'meetingsBooked',
    ] as const;
    const present: Partial<Record<string, boolean>> = {};
    const sum: Partial<Record<string, number>> = {};
    for (const r of runs) {
      const m = r.metrics;
      if (!m) continue;
      for (const k of FUNNEL_KEYS) {
        const v = m[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
          present[k] = true;
          sum[k] = (sum[k] ?? 0) + v;
        }
      }
    }
    const funnelVal = (k: string): number | null =>
      present[k] ? (sum[k] ?? 0) : null;
    const funnel = {
      leadsFound: funnelVal('leadsFound'),
      emailsSent: funnelVal('emailsSent'),
      repliesHandled: funnelVal('repliesHandled'),
      meetingsBooked: funnelVal('meetingsBooked'),
    };

    const totalOk = runs.filter((r) => isArsenalRunOk(r.status)).length;

    const campaignRows = await this.db
      .select()
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));
    const campaignsLaunched = campaignRows.filter((c) => {
      if (campaignId && c.id !== campaignId) return false;
      // "Launched" in the report = went live (activatedAt); fall back to createdAt
      // for campaigns still DRAFT.
      const when = c.activatedAt ?? c.createdAt;
      return when ? indexOf(new Date(when)) >= 0 : false;
    }).length;

    return {
      period,
      campaignId: campaignId ?? null,
      from: from.toISOString(),
      to: now.toISOString(),
      buckets: labels,
      kpis: {
        campaignsLaunched,
        totalRuns: runs.length,
        successRate: runs.length ? totalOk / runs.length : null,
        meetingsBooked: funnel.meetingsBooked,
      },
      funnel,
      stages,
    };
  }

  // Build the time buckets for a period: a ROLLING window — day = last 24h
  // (hourly bars), week = last 7 days, month = last 30 days (daily bars). Returns
  // the window start, bucket-start labels (oldest->newest), and a date->bucket-index
  // fn (-1 = outside the window).
  private buildBuckets(period: MarketingReportPeriod, now: Date) {
    const HOUR = 3_600_000;
    const DAY = 86_400_000;
    const labels: string[] = [];
    let from: Date;
    let indexOf: (d: Date) => number;

    if (period === 'day') {
      // Last 24 hours, one bar per hour (epoch-aligned hour boundaries).
      const N = 24;
      const curHour = Math.floor(now.getTime() / HOUR) * HOUR;
      const start = curHour - (N - 1) * HOUR;
      from = new Date(start);
      for (let i = 0; i < N; i++) {
        labels.push(new Date(start + i * HOUR).toISOString());
      }
      indexOf = (d) => {
        const h = Math.floor(d.getTime() / HOUR) * HOUR;
        const idx = Math.round((h - start) / HOUR);
        return idx >= 0 && idx < N ? idx : -1;
      };
    } else {
      // week = last 7 days, month = last 30 days; one bar per UTC day.
      const N = period === 'week' ? 7 : 30;
      const today = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      );
      const start = today - (N - 1) * DAY;
      from = new Date(start);
      for (let i = 0; i < N; i++) {
        labels.push(new Date(start + i * DAY).toISOString().slice(0, 10));
      }
      indexOf = (d) => {
        const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        const idx = Math.round((day - start) / DAY);
        return idx >= 0 && idx < N ? idx : -1;
      };
    }
    return { from, labels, indexOf, count: labels.length };
  }

  // Dispatch to the ERP-native Python agent service (POST /<agent>/run, live).
  // The agent runs synchronously then posts its own /arsenal/runs/callback with the
  // final metrics; here we record only the hand-off (DISPATCHED on a 2xx). Generous
  // timeout because agents do real work (LLM + sends) before returning.
  private async fireAgent(
    baseUrl: string,
    stage: ArsenalStage,
    body: {
      campaignId: string | null;
      campaign: string | null;
      llm: { baseUrl: string; model: string; apiKey: string };
      scraper: {
        leadTarget: number | null;
        maxQueries: number | null;
        minScore: number | null;
      };
    },
  ): Promise<{ status: 'DISPATCHED' | 'FAILED'; detail: string }> {
    const url = baseUrl.replace(/\/+$/, '') + STAGE_AGENT_PATH[stage];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          live: true,
          source: 'erp',
          campaignId: body.campaignId ?? undefined,
          campaign: body.campaign ?? undefined,
          // Per-org agent LLM override (org_config ?? env). Blank fields are sent as
          // undefined so the agent keeps its own env default (request value ?? env).
          llmBaseUrl: body.llm.baseUrl || undefined,
          model: body.llm.model || undefined,
          apiKey: body.llm.apiKey || undefined,
          // Per-org Lead Scraper tuning (org_config). Null → omitted so the agent keeps
          // its own env default (request value ?? agent env).
          leadTarget: body.scraper.leadTarget ?? undefined,
          maxQueries: body.scraper.maxQueries ?? undefined,
          minScore: body.scraper.minScore ?? undefined,
        }),
        signal: controller.signal,
      });
      return res.ok
        ? { status: 'DISPATCHED', detail: `agent HTTP ${res.status}` }
        : { status: 'FAILED', detail: `agent HTTP ${res.status}` };
    } catch (err) {
      return {
        status: 'FAILED',
        detail: err instanceof Error ? err.message : 'agent call failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Hit the stage webhook with its configured method; map the outcome to a run
  // status + detail. GET webhooks just trigger the workflow (no body); POST ones
  // carry the JSON payload (campaign context).
  private async fire(
    webhookUrl: string,
    method: 'GET' | 'POST',
    payload: Record<string, unknown>,
  ): Promise<{ status: 'DISPATCHED' | 'FAILED'; detail: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(webhookUrl, {
        method,
        headers:
          method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
      return res.ok
        ? { status: 'DISPATCHED', detail: `HTTP ${res.status}` }
        : { status: 'FAILED', detail: `webhook HTTP ${res.status}` };
    } catch (err) {
      return {
        status: 'FAILED',
        detail: err instanceof Error ? err.message : 'webhook call failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Load a campaign within the org, or 404.
  private async requireCampaign(
    orgId: string,
    campaignId: string,
  ): Promise<CampaignRow> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(
        and(
          tenantScope(orgId, schema.campaigns),
          eq(schema.campaigns.id, campaignId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Campaign not found');
    return row;
  }

  // The campaign context PER_CAMPAIGN stages receive (the AIM inputs + Drive refs).
  // niche is resolved to its DISPLAY name from the campaign's nicheId (the old
  // free-text niche/target columns are gone; target archetypes now live on
  // niche_targets, which the stage fetches via GET /campaigns/:id/config).
  private async campaignPayload(c: CampaignRow) {
    const niche = await this.db
      .select({ name: schema.niches.name })
      .from(schema.niches)
      .where(eq(schema.niches.id, c.nicheId))
      .limit(1);
    return {
      campaignId: c.id,
      name: c.name,
      niche: niche[0]?.name ?? null,
      country: c.country,
      region: c.region,
      project: c.project,
      sender: c.sender,
      gmailLabel: c.gmailLabel,
      salesCalendarId: c.salesCalendarId,
      whatsappNumber: c.whatsappNumber,
      driveFolderId: c.driveFolderId,
      driveFolderUrl: c.driveFolderUrl,
    };
  }
}
