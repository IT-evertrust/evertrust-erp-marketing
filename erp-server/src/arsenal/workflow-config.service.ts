import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  ArsenalStage,
  DefaultSender,
  DefaultTemplateDto,
  LeadStatsDto,
  OutreachTone,
  TemplateLanguage,
  TestN8nResultDto,
  UpdateWorkflowConfigDto,
  WorkflowConfigDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { AppConfigService } from '../config/app-config.service';
import type { Env } from '../config/env.schema';

type WorkflowConfigRow = typeof schema.workflowConfig.$inferSelect;

// The five arsenal stages map to (stored column on workflow_config, env var). AIM
// is handled separately (it's the campaign launch, not an arsenal stage) but shares
// the same resolution shape. `as const satisfies` keeps the literal env-key types
// while checking every value is a real Env key.
const STAGE_WEBHOOK_ENV = {
  LEAD_SATELLITE: 'N8N_LEAD_SATELLITE_WEBHOOK_URL',
  AMMO_FORGE: 'N8N_AMMO_FORGE_WEBHOOK_URL',
  REACH_BAZOOKA: 'N8N_REACH_BAZOOKA_WEBHOOK_URL',
  REPLY_GLOCK: 'N8N_REPLY_GLOCK_WEBHOOK_URL',
  SLEEPER_GRENADE: 'N8N_SLEEPER_GRENADE_WEBHOOK_URL',
} as const satisfies Record<ArsenalStage, keyof Env>;

// ArsenalStage -> the stored override column on the singleton row.
const STAGE_WEBHOOK_COLUMN = {
  LEAD_SATELLITE: 'leadSatelliteWebhookUrl',
  AMMO_FORGE: 'ammoForgeWebhookUrl',
  REACH_BAZOOKA: 'reachBazookaWebhookUrl',
  REPLY_GLOCK: 'replyGlockWebhookUrl',
  SLEEPER_GRENADE: 'sleeperGrenadeWebhookUrl',
} as const satisfies Record<ArsenalStage, keyof WorkflowConfigRow>;

const CACHE_TTL_MS = 5_000;

// Short timeout for the admin "test connection" probe — fail fast, the operator is
// waiting on the response. (The status poller uses a longer 8s budget.)
const TEST_TIMEOUT_MS = 5_000;

// Trim + treat blank as "unset" so a stored "" (or the env default "") resolves to
// undefined — preserving every consumer's existing "not configured" behavior.
function clean(v: string | null | undefined): string | undefined {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : undefined;
}

// Resolves the GLOBAL Growth-Engine workflow config from the workflow_config
// singleton, with the env var as the fallback for every field. The point: make the
// n8n wiring (webhook URLs, the n8n API base, the ingest-token auth, sequence
// offsets) admin-editable from the ERP without a redeploy, while staying 100%
// env-driven until an admin actually overrides a field.
//
// A tiny in-memory cache (TTL ~5s) keeps the per-request guard read off the DB hot
// path; update()/setIngestTokenHash() invalidate it so a write is visible at once.
// Secrets are never returned to callers: the n8n API key stays in env, and the
// ingest token is only ever stored/compared as a SHA-256 hash (set elsewhere).
@Injectable()
export class WorkflowConfigService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
  ) {}

  private cache: { row: WorkflowConfigRow | null; at: number } | null = null;

  // The singleton row (or null when none exists yet), memoized for CACHE_TTL_MS.
  private async row(): Promise<WorkflowConfigRow | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return this.cache.row;
    }
    const rows = await this.db.select().from(schema.workflowConfig).limit(1);
    const row = rows[0] ?? null;
    this.cache = { row, at: now };
    return row;
  }

  // Drop the cached row so the next read re-fetches (called after any write).
  invalidate(): void {
    this.cache = null;
  }

  // ----- resolvers (stored override ?? env) --------------------------------

  // The effective webhook URL for an arsenal stage, or undefined when neither a
  // stored override nor the env var is set (so the caller still fails "not wired up").
  async getStageWebhook(stage: ArsenalStage): Promise<string | undefined> {
    const row = await this.row();
    const stored = row ? (row[STAGE_WEBHOOK_COLUMN[stage]] as string | null) : null;
    return clean(stored) ?? clean(this.config.get(STAGE_WEBHOOK_ENV[stage]));
  }

  // The effective AIM ("deploy campaign") webhook URL, or undefined when unset.
  async getAimWebhook(): Promise<string | undefined> {
    const row = await this.row();
    return clean(row?.aimWebhookUrl) ?? clean(this.config.get('N8N_AIM_WEBHOOK_URL'));
  }

  // The effective n8n public-API base URL, or undefined when unset (the API *key*
  // is never overridable — it stays in env).
  async getN8nApiUrl(): Promise<string | undefined> {
    const row = await this.row();
    return clean(row?.n8nApiUrl) ?? clean(this.config.get('N8N_API_URL'));
  }

  // The active ingest-token SHA-256 hash, or null when no token has been rotated
  // (→ the guard falls back to the env ARSENAL_INGEST_TOKEN constant-time compare).
  async getIngestTokenHash(): Promise<string | null> {
    const row = await this.row();
    return clean(row?.ingestTokenHash) ?? null;
  }

  // ----- full read shape (GET /arsenal/config) -----------------------------

  // Build the resolved WorkflowConfigDto: each webhook + the n8n base carry
  // {value, overridden}; secrets are status-only.
  async getEffective(): Promise<WorkflowConfigDto> {
    const row = await this.row();
    const env = this.config;

    const field = (stored: string | null | undefined, envVal: string | undefined) => {
      const overridden = clean(stored) !== undefined;
      return { value: clean(stored) ?? clean(envVal) ?? null, overridden };
    };

    const storedHash = clean(row?.ingestTokenHash);
    const envToken = clean(env.get('ARSENAL_INGEST_TOKEN'));
    const ingestTokenSource: 'rotated' | 'env' | 'none' = storedHash
      ? 'rotated'
      : envToken
        ? 'env'
        : 'none';

    return {
      webhooks: {
        aim: field(row?.aimWebhookUrl, env.get('N8N_AIM_WEBHOOK_URL')),
        leadSatellite: field(
          row?.leadSatelliteWebhookUrl,
          env.get('N8N_LEAD_SATELLITE_WEBHOOK_URL'),
        ),
        ammoForge: field(
          row?.ammoForgeWebhookUrl,
          env.get('N8N_AMMO_FORGE_WEBHOOK_URL'),
        ),
        reachBazooka: field(
          row?.reachBazookaWebhookUrl,
          env.get('N8N_REACH_BAZOOKA_WEBHOOK_URL'),
        ),
        replyGlock: field(
          row?.replyGlockWebhookUrl,
          env.get('N8N_REPLY_GLOCK_WEBHOOK_URL'),
        ),
        sleeperGrenade: field(
          row?.sleeperGrenadeWebhookUrl,
          env.get('N8N_SLEEPER_GRENADE_WEBHOOK_URL'),
        ),
      },
      n8nApiUrl: field(row?.n8nApiUrl, env.get('N8N_API_URL')),
      n8nApiKeySet: clean(env.get('N8N_API_KEY')) !== undefined,
      ingestTokenSet: ingestTokenSource !== 'none',
      ingestTokenSource,
      ingestTokenSetAt: row?.ingestTokenSetAt
        ? row.ingestTokenSetAt.toISOString()
        : null,
      defaultSender: (clean(row?.defaultSender) ?? null) as DefaultSender | null,
      followupOffsetDays: row?.followupOffsetDays ?? null,
      finalPushOffsetDays: row?.finalPushOffsetDays ?? null,
      // Templates: raw stored values, nullable (no env fallback). `defaultTemplate`
      // is jsonb (typed unknown) → surfaced as the DTO shape or null.
      templates: {
        default: (row?.defaultTemplate ?? null) as DefaultTemplateDto | null,
        signature: clean(row?.signature) ?? null,
        tone: (clean(row?.tone) ?? null) as OutreachTone | null,
        language: (clean(row?.templateLanguage) ?? null) as TemplateLanguage | null,
      },
      // Leads: caps are raw nullable (null = no cap); regions default to []. The two
      // booleans are EFFECTIVE with a safe product default of `true` — an unset
      // (null) value must never read as "off" (so suppressions are honoured and a
      // niche analysis is required until an admin explicitly turns them off).
      leads: {
        maxLeadsPerRun: row?.maxLeadsPerRun ?? null,
        maxPerNiche: row?.maxPerNiche ?? null,
        dailySendCap: row?.dailySendCap ?? null,
        defaultRegions: row?.defaultRegions ?? [],
        respectSuppressions: row?.respectSuppressions ?? true,
        dedupDays: row?.dedupDays ?? null,
        requireNicheAnalysis: row?.requireNicheAnalysis ?? true,
      },
    };
  }

  // ----- lead stats (GET /arsenal/lead-stats) ------------------------------

  // Org-scoped counts for the Configuration page's metric strip: total leads,
  // prospects, and suppression-list entries for the caller's tenant. Each is a
  // single COUNT scoped via tenantScope (the same org confinement the list
  // endpoints use). NOT memoized — it's an admin page read, not a hot path.
  async getLeadStats(orgId: string): Promise<LeadStatsDto> {
    const [leads, prospects, suppressed] = await Promise.all([
      this.countFor(schema.leads, orgId),
      this.countFor(schema.prospects, orgId),
      this.countFor(schema.suppressions, orgId),
    ]);
    return { leads, prospects, suppressed };
  }

  // COUNT(*) of an org-scoped table confined to one tenant. `count()` returns one
  // row { value: number }; default to 0 if the driver returns nothing.
  private async countFor(
    table: typeof schema.leads | typeof schema.prospects | typeof schema.suppressions,
    orgId: string,
  ): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(table)
      .where(tenantScope(orgId, table));
    return rows[0]?.value ?? 0;
  }

  // ----- writes ------------------------------------------------------------

  // Upsert the singleton, applying ONLY the provided keys: a value sets the
  // override, `null` clears it (→ env), an omitted key is left unchanged. Returns
  // the freshly resolved config. No onConflict needed — the table holds one row, so
  // we find-or-create it (mirrors arsenal_settings' upsert).
  async update(patch: UpdateWorkflowConfigDto): Promise<WorkflowConfigDto> {
    const set: Partial<typeof schema.workflowConfig.$inferInsert> = {};

    if (patch.webhooks) {
      const w = patch.webhooks;
      if ('aim' in w) set.aimWebhookUrl = w.aim ?? null;
      if ('leadSatellite' in w) set.leadSatelliteWebhookUrl = w.leadSatellite ?? null;
      if ('ammoForge' in w) set.ammoForgeWebhookUrl = w.ammoForge ?? null;
      if ('reachBazooka' in w) set.reachBazookaWebhookUrl = w.reachBazooka ?? null;
      if ('replyGlock' in w) set.replyGlockWebhookUrl = w.replyGlock ?? null;
      if ('sleeperGrenade' in w) {
        set.sleeperGrenadeWebhookUrl = w.sleeperGrenade ?? null;
      }
    }
    if ('n8nApiUrl' in patch) set.n8nApiUrl = patch.n8nApiUrl ?? null;
    if ('defaultSender' in patch) set.defaultSender = patch.defaultSender ?? null;
    if ('followupOffsetDays' in patch) {
      set.followupOffsetDays = patch.followupOffsetDays ?? null;
    }
    if ('finalPushOffsetDays' in patch) {
      set.finalPushOffsetDays = patch.finalPushOffsetDays ?? null;
    }

    // Templates group — each sub-field independent: a value sets it, null clears it,
    // an omitted key is left unchanged. `default` is stored as the jsonb object (or
    // null to clear the baseline).
    if (patch.templates) {
      const t = patch.templates;
      if ('default' in t) set.defaultTemplate = t.default ?? null;
      if ('signature' in t) set.signature = t.signature ?? null;
      if ('tone' in t) set.tone = t.tone ?? null;
      if ('language' in t) set.templateLanguage = t.language ?? null;
    }

    // Leads group — caps: value sets / null clears; defaultRegions replaces the
    // stored array wholesale when provided; the two booleans set directly.
    if (patch.leads) {
      const l = patch.leads;
      if ('maxLeadsPerRun' in l) set.maxLeadsPerRun = l.maxLeadsPerRun ?? null;
      if ('maxPerNiche' in l) set.maxPerNiche = l.maxPerNiche ?? null;
      if ('dailySendCap' in l) set.dailySendCap = l.dailySendCap ?? null;
      if ('defaultRegions' in l && l.defaultRegions !== undefined) {
        set.defaultRegions = l.defaultRegions;
      }
      if ('respectSuppressions' in l && l.respectSuppressions !== undefined) {
        set.respectSuppressions = l.respectSuppressions;
      }
      if ('dedupDays' in l) set.dedupDays = l.dedupDays ?? null;
      if ('requireNicheAnalysis' in l && l.requireNicheAnalysis !== undefined) {
        set.requireNicheAnalysis = l.requireNicheAnalysis;
      }
    }

    await this.persist(set);
    this.invalidate();
    return this.getEffective();
  }

  // Set (or clear, with hash=null) the ingest-token SHA-256 hash + its set-at
  // stamp. Wired now so the surface is ready for the rotation phase; there is no
  // rotation endpoint yet.
  async setIngestTokenHash(hash: string | null, setAt: Date | null): Promise<void> {
    await this.persist({
      ingestTokenHash: hash,
      ingestTokenSetAt: setAt,
    });
    this.invalidate();
  }

  // ----- admin actions (POST /arsenal/config/test-n8n, rotate-token, …) -----

  // Probe the n8n public API to confirm the resolved base URL (stored override ??
  // env) + the env N8N_API_KEY actually authenticate. Mirrors the calling convention
  // of N8nExecutionsService (GET ${base}/api/v1/..., the `X-N8N-API-KEY` header, a
  // short AbortController timeout). NEVER throws: when the URL/key is unset it reports
  // `configured:false`; any non-2xx or network error is surfaced in `detail` with
  // `ok:false`. `workflowCount` is read from the body when exposed, else null.
  async testN8nConnection(): Promise<TestN8nResultDto> {
    const baseUrl = await this.getN8nApiUrl();
    const key = this.config.get('N8N_API_KEY').trim();
    if (!baseUrl || key.length === 0) {
      return {
        ok: false,
        configured: false,
        detail: 'n8n API URL or key not set',
        workflowCount: null,
      };
    }

    const base = baseUrl.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/api/v1/workflows?limit=1`, {
        headers: { 'X-N8N-API-KEY': key, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          configured: true,
          detail: `HTTP ${res.status}`,
          workflowCount: null,
        };
      }
      // n8n returns { data: Workflow[] }; `limit=1` caps the page, so the array
      // length is at most 1 — surface it when present, else null (the body shape
      // is best-effort, the probe's real signal is the 2xx auth).
      const json = (await res.json()) as { data?: unknown[] } | unknown;
      const data =
        json && typeof json === 'object' && 'data' in json
          ? (json as { data?: unknown[] }).data
          : undefined;
      const workflowCount = Array.isArray(data) ? data.length : null;
      return { ok: true, configured: true, detail: 'Connected', workflowCount };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        detail: err instanceof Error ? err.message : 'Connection failed',
        workflowCount: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Mint a fresh machine ingest token: a 256-bit url-safe random string. Only its
  // SHA-256 hash is persisted (so the guard's hash-compare path activates); the
  // plaintext is returned ONCE for the admin to paste into n8n and is never stored.
  async rotateIngestToken(): Promise<{ token: string; setAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const setAt = new Date();
    await this.setIngestTokenHash(hash, setAt);
    return { token, setAt };
  }

  // Clear the rotated token (hash + stamp → null), reverting machine-route auth to
  // the env ARSENAL_INGEST_TOKEN fallback.
  async clearIngestToken(): Promise<void> {
    await this.setIngestTokenHash(null, null);
  }

  // Find-or-create the singleton row and apply the partial set. `updatedAt` is
  // always bumped. Reads the row directly (not the cache) so concurrent writers
  // don't race on a stale memoized row.
  private async persist(
    set: Partial<typeof schema.workflowConfig.$inferInsert>,
  ): Promise<void> {
    const rows = await this.db.select().from(schema.workflowConfig).limit(1);
    const existing = rows[0];
    if (existing) {
      await this.db
        .update(schema.workflowConfig)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(schema.workflowConfig.id, existing.id));
    } else {
      await this.db
        .insert(schema.workflowConfig)
        .values({ singleton: true, ...set });
    }
  }
}
