import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema } from '@evertrust/db';
import type { ArsenalBackfillResultDto, ArsenalStage } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { AppConfigService } from '../config/app-config.service';
import { STAGE_WORKFLOW_ID } from './n8n-executions.service';

// --- n8n execution-data shapes (only the bits we read) ----------------------
interface RunItem {
  json?: Record<string, unknown>;
}
interface NodeRun {
  data?: { main?: Array<RunItem[] | null> };
}
type RunData = Record<string, NodeRun[] | undefined>;

interface ExecSummary {
  id: string;
  status?: string;
  mode?: string;
  stoppedAt?: string | null;
}

// How many recent executions per workflow to scan on a sync. New ones (not yet
// imported) are fetched with data; already-imported ids are skipped cheaply.
const SCAN_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 12_000;

// --- runData read helpers (tolerant; missing node => empty/0) ----------------
function nodeRuns(rd: RunData, name: string): NodeRun[] {
  return rd[name] ?? [];
}
function runCount(rd: RunData, name: string): number {
  return nodeRuns(rd, name).length;
}
function items(rd: RunData, name: string, run = 0): RunItem[] {
  return nodeRuns(rd, name)[run]?.data?.main?.[0] ?? [];
}
function firstJson(
  rd: RunData,
  name: string,
  run = 0,
): Record<string, unknown> | undefined {
  return items(rd, name, run)[0]?.json;
}
function numField(json: Record<string, unknown> | undefined, key: string): number {
  const v = json?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function strField(
  json: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const v = json?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Read a stage's funnel metrics (and the campaign Drive folder, where the stage
// is per-campaign) out of one execution's runData. Node names + paths are the
// ones verified against live execution data. Everything is best-effort: a missing
// node yields 0, never throws.
export function extractMetrics(
  stage: ArsenalStage,
  rd: RunData,
): { metrics: Record<string, number>; campaignFolderId: string | null } {
  switch (stage) {
    case 'LEAD_SATELLITE':
      return {
        metrics: { leadsFound: items(rd, 'Append Leads Rows').length },
        campaignFolderId: strField(
          firstJson(rd, 'Decide: Should Hunt?'),
          'campaignFolderId',
        ),
      };
    case 'AMMO_FORGE':
      return {
        metrics: { templatesForged: runCount(rd, 'Upload Template Doc') },
        campaignFolderId: strField(
          firstJson(rd, 'Merge To Single Doc'),
          'campaignFolderId',
        ),
      };
    case 'REACH_BAZOOKA':
      return {
        metrics: { emailsSent: runCount(rd, 'Gmail — Send Outreach') },
        campaignFolderId: null,
      };
    case 'REPLY_GLOCK': {
      const agg = firstJson(rd, 'Code — Aggregate Daily Counts');
      return {
        metrics: {
          repliesHandled:
            numField(agg, 'interested') +
            numField(agg, 'unsure') +
            numField(agg, 'notInterested'),
          meetingsBooked: runCount(rd, 'Calendar — Create Meeting'),
        },
        campaignFolderId: null,
      };
    }
    case 'SLEEPER_GRENADE': {
      const summary = firstJson(rd, 'Build Summary');
      let leadsSwept: number;
      if (summary) {
        leadsSwept = numField(summary, 'snoozed') + numField(summary, 'deleted');
      } else {
        leadsSwept = nodeRuns(rd, 'Record Result').reduce((acc, _r, i) => {
          const j = firstJson(rd, 'Record Result', i);
          return acc + numField(j, 'snoozed') + numField(j, 'deleted');
        }, 0);
      }
      return { metrics: { leadsSwept }, campaignFolderId: null };
    }
  }
}

// Distinct campaign Drive-folder ids that actually appear on PROCESSED items in
// this execution — i.e. the campaigns a global-stage run touched. The folder id
// is only ever written to a `campaignFolderId` field by the workflow's own Code
// nodes (Explode Campaigns, Check Required Files, …), so raw Drive folder listings
// (which use `id`/`name`) never leak in. Used to attribute a global run to a
// campaign when it provably touched exactly one.
export function touchedFolderIds(rd: RunData): string[] {
  const set = new Set<string>();
  for (const nodeRunsList of Object.values(rd)) {
    for (const r of nodeRunsList ?? []) {
      for (const arr of r?.data?.main ?? []) {
        for (const it of arr ?? []) {
          const f = it?.json?.['campaignFolderId'];
          if (typeof f === 'string' && f.length > 0) set.add(f);
        }
      }
    }
  }
  return [...set];
}

// Resolve the single ERP campaign a global run belongs to: map every touched
// folder id to its ERP campaign and return it ONLY if exactly one distinct
// campaign matched. Zero or many touched campaigns => null (kept org-wide, so we
// never fabricate a per-campaign number the workflow aggregated globally).
export function resolveTouchedCampaign<T extends { id: string }>(
  folderIds: string[],
  byFolder: Map<string, T>,
): T | null {
  const uniq = new Map<string, T>();
  for (const f of folderIds) {
    const c = byFolder.get(f);
    if (c) uniq.set(c.id, c);
  }
  const arr = [...uniq.values()];
  return arr.length === 1 ? (arr[0] as T) : null;
}

// Imports recent n8n executions as arsenal_runs rows with funnel metrics read from
// each execution's data (READ-ONLY against n8n). Idempotent: dedup by the n8n
// execution id (one row per execution). Per-campaign stages (Lead Satellite, Ammo
// Forge) attach to a campaign by their own Drive folder id; the global stages
// (Bazooka/Glock/Sleeper, which aggregate metrics across a single looped run) are
// attributed to a campaign when that run touched exactly one, else stay org-wide.
@Injectable()
export class N8nBackfillService {
  private readonly logger = new Logger(N8nBackfillService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
  ) {}

  private isConfigured(): boolean {
    return (
      this.config.get('N8N_API_URL').trim().length > 0 &&
      this.config.get('N8N_API_KEY').trim().length > 0
    );
  }

  async sync(orgId: string): Promise<ArsenalBackfillResultDto> {
    if (!this.isConfigured()) {
      return { configured: false, scanned: 0, imported: 0, byStage: {} };
    }
    const base = this.config.get('N8N_API_URL').trim().replace(/\/+$/, '');
    const key = this.config.get('N8N_API_KEY').trim();

    // Already-imported execution ids (idempotency) + campaign folder lookup.
    const existing = await this.db.select().from(schema.arsenalRuns);
    const seen = new Set(
      existing
        .map((r) => r.n8nExecutionId)
        .filter((id): id is string => !!id),
    );
    const campaigns = await this.db
      .select()
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));
    const byFolder = new Map(
      campaigns
        .filter((c) => c.driveFolderId)
        .map((c) => [c.driveFolderId as string, c] as const),
    );

    let scanned = 0;
    let imported = 0;
    const byStage: Record<string, number> = {};

    for (const [stage, workflowId] of Object.entries(STAGE_WORKFLOW_ID) as [
      ArsenalStage,
      string,
    ][]) {
      const list = await this.listExecutions(base, key, workflowId);
      for (const exec of list) {
        // Skip running, error-handler runs, and anything already imported.
        if (!exec.stoppedAt || exec.mode === 'error' || seen.has(exec.id)) {
          continue;
        }
        scanned += 1;
        const rd = await this.fetchRunData(base, key, exec.id);
        if (!rd) continue;
        const { metrics, campaignFolderId } = extractMetrics(stage, rd);
        // Per-campaign stages carry their own folder id. Global stages (folder id
        // null) get attributed to a campaign only if the run provably touched
        // exactly one ERP campaign — so a single-campaign org's funnel lights up
        // per campaign, while genuinely multi-campaign runs stay org-wide.
        const campaign =
          (campaignFolderId ? byFolder.get(campaignFolderId) : undefined) ??
          (campaignFolderId
            ? undefined
            : (resolveTouchedCampaign(touchedFolderIds(rd), byFolder) ??
              undefined));
        await this.db.insert(schema.arsenalRuns).values({
          organizationId: campaign?.organizationId ?? orgId,
          stage,
          campaignId: campaign?.id ?? null,
          source: 'N8N',
          status: exec.status === 'error' ? 'ERROR' : 'SUCCESS',
          detail: `imported from n8n execution ${exec.id}`,
          metrics,
          n8nExecutionId: exec.id,
          triggeredBy: null,
          createdAt: new Date(exec.stoppedAt),
        });
        seen.add(exec.id);
        imported += 1;
        byStage[stage] = (byStage[stage] ?? 0) + 1;
      }
    }

    this.logger.log(
      `n8n backfill: scanned ${scanned}, imported ${imported} (${JSON.stringify(byStage)})`,
    );
    return { configured: true, scanned, imported, byStage };
  }

  private async listExecutions(
    base: string,
    key: string,
    workflowId: string,
  ): Promise<ExecSummary[]> {
    const json = await this.fetchJson(
      `${base}/api/v1/executions?workflowId=${encodeURIComponent(workflowId)}&limit=${SCAN_LIMIT}`,
      key,
    );
    const data = (json as { data?: ExecSummary[] } | null)?.data;
    return Array.isArray(data) ? data : [];
  }

  private async fetchRunData(
    base: string,
    key: string,
    execId: string,
  ): Promise<RunData | null> {
    const json = await this.fetchJson(
      `${base}/api/v1/executions/${encodeURIComponent(execId)}?includeData=true`,
      key,
    );
    const rd = (json as { data?: { resultData?: { runData?: RunData } } } | null)
      ?.data?.resultData?.runData;
    return rd && typeof rd === 'object' ? rd : null;
  }

  // GET helper — returns parsed JSON or null on any error (never throws, so one
  // bad execution can't abort the whole sync).
  private async fetchJson(url: string, key: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'X-N8N-API-KEY': key, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`n8n backfill GET ${url}: HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      this.logger.warn(
        `n8n backfill GET failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
