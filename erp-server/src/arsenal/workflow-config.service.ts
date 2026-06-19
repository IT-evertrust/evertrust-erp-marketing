import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { DEFAULT_SENDERS } from '@evertrust/shared';
import type {
  AiEngineConfigDto,
  ArsenalStage,
  DefaultSender,
  DefaultTemplateDto,
  LeadStatsDto,
  OrgSenderDto,
  OutreachTone,
  TemplateLanguage,
  TestN8nResultDto,
  UpdateAiEngineDto,
  UpdateWorkflowConfigDto,
  WorkflowConfigDto,
  WorkflowLeadsDto,
  WorkflowTemplatesDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { AppConfigService } from '../config/app-config.service';
import type { Env } from '../config/env.schema';
import { SendersService } from './senders.service';

// The resolved Growth-Engine automation block merged into the machine campaign config:
// the effective Templates + Leads groups (PER-ORG) PLUS the resolved sender list, the
// resolved default sender's EMAIL (so n8n can set the From directly), and the resolved
// salesCalendarId. The senders/default-email/calendar fields extend the base
// templates+leads shape the outreach workflows already poll.
export interface ResolvedAutomation {
  templates: WorkflowTemplatesDto;
  leads: WorkflowLeadsDto;
  // The org's resolved sender list (its own senders, or DEFAULT_SENDERS when none).
  senders: OrgSenderDto[];
  // The resolved default sender's EMAIL (the from-address n8n should send as), or null
  // when nothing resolves (no senders at all — should not happen given DEFAULT_SENDERS).
  defaultSenderEmail: string | null;
  // The org's resolved sales calendar id (org_config ?? env ?? null).
  salesCalendarId: string | null;
}

type WorkflowConfigRow = typeof schema.workflowConfig.$inferSelect;
type OrgConfigRow = typeof schema.orgConfig.$inferSelect;

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

// ArsenalStage -> the env var holding that stage's Python-agent service base URL.
// When set, it takes precedence over the n8n webhook (the ERP-native agent path).
const STAGE_AGENT_ENV = {
  LEAD_SATELLITE: 'AGENT_LEAD_SATELLITE_URL',
  AMMO_FORGE: 'AGENT_AMMO_FORGE_URL',
  REACH_BAZOOKA: 'AGENT_REACH_BAZOOKA_URL',
  REPLY_GLOCK: 'AGENT_REPLY_GLOCK_URL',
  SLEEPER_GRENADE: 'AGENT_SLEEPER_GRENADE_URL',
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

// Resolves the Growth-Engine workflow config in TWO halves (design B):
//   - GLOBAL INFRA (the workflow_config singleton): the n8n wiring (webhook URLs,
//     the n8n API base, the ingest-token auth, the sequence offsets), env-fallback
//     per field. One shared n8n + API for all tenants — never per-org.
//   - PER-ORG PREFS (the org_config table, one row per org): the customer-facing
//     outreach prefs (templates, signature, tone, language, default sender) + lead
//     governance. Resolved as org_config value ?? product default (no env layer).
//
// The point: make the n8n wiring admin-editable from the ERP without a redeploy
// (staying 100% env-driven until an admin overrides a field), while every tenant
// keeps its own outreach prefs.
//
// A tiny in-memory cache (TTL ~5s) keeps the per-request infra read off the DB hot
// path; update()/setIngestTokenHash() invalidate it so a write is visible at once.
// Per-org pref reads are NOT cached (they are admin-page / machine-config reads, not
// a guard hot path, and caching per org adds little). Secrets are never returned to
// callers: the n8n API key stays in env, and the ingest token is only ever stored/
// compared as a SHA-256 hash (set elsewhere).
@Injectable()
export class WorkflowConfigService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
    private readonly senders: SendersService,
  ) {}

  private cache: { row: WorkflowConfigRow | null; at: number } | null = null;

  // The GLOBAL infra singleton row (or null when none exists yet), memoized for
  // CACHE_TTL_MS.
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

  // Find-or-create the PER-ORG org_config row, returning it. First read for an org
  // inserts a bare { organizationId } row (every pref column NULLABLE → all default
  // to the product default until set), so a resolver never has to handle a missing
  // row. onConflict(organizationId) makes the insert race-safe (the unique index is
  // org_config_organization_id_uq); we re-select after to return the canonical row.
  private async orgRow(orgId: string): Promise<OrgConfigRow> {
    const existing = await this.db
      .select()
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    if (existing[0]) return existing[0];

    const inserted = await this.db
      .insert(schema.orgConfig)
      .values({ organizationId: orgId })
      .onConflictDoNothing({ target: schema.orgConfig.organizationId })
      .returning();
    if (inserted[0]) return inserted[0];

    // Lost the insert race — the row now exists; re-read it.
    const reread = await this.db
      .select()
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    return reread[0]!;
  }

  // Drop the cached infra row so the next read re-fetches (called after any write).
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

  // The org's RESOLVED sender list (its own org_senders rows, or the product
  // DEFAULT_SENDERS when it has none). A thin passthrough to SendersService so callers
  // that already depend on WorkflowConfigService (e.g. CampaignsService' create-time
  // sender-key validation) don't have to inject SendersService directly.
  resolveSenders(orgId: string): Promise<OrgSenderDto[]> {
    return this.senders.resolve(orgId);
  }

  // The effective Python-agent service base URL for a stage, or undefined when
  // unset. When set, ArsenalService dispatches to the agent (POST /<agent>/run)
  // instead of the n8n webhook (env-only — no stored override yet).
  getStageAgentUrl(stage: ArsenalStage): string | undefined {
    return clean(this.config.get(STAGE_AGENT_ENV[stage]));
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

  // Build the resolved WorkflowConfigDto for the caller's org: the GLOBAL infra
  // (webhooks + n8n base carry {value, overridden}, secrets status-only) composed
  // with the PER-ORG prefs (templates + leads + default sender) from org_config.
  // The wire shape is unchanged — the web client is unaffected.
  async getEffective(orgId: string): Promise<WorkflowConfigDto> {
    const row = await this.row();
    const orgRow = await this.orgRow(orgId);
    const env = this.config;
    const { senders, fromOrg } = await this.senders.resolveDetailed(orgId);

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
      // defaultSender is now a PER-ORG pref (org_config), no env fallback. It is the
      // KEY of the org's default sender (the resolved sender list carries the address).
      defaultSender: this.resolveDefaultSenderKey(orgRow, senders, fromOrg) as
        | DefaultSender
        | null,
      // The resolved per-org sender list (the org's own rows, or DEFAULT_SENDERS).
      senders,
      // org_config ?? env SALES_CALENDAR_ID ?? null.
      salesCalendarId: this.resolveSalesCalendarId(orgRow),
      // RAW per-org timezone overrides for the settings form (null = inherit the
      // product default 'Europe/Berlin' / no secondary gutter). The EFFECTIVE zone the
      // calendar renders in is resolved in GoogleCalendarReadService (org ?? env ?? default).
      salesTimeZone: clean(orgRow.salesTimeZone) ?? null,
      salesSecondaryTimeZone: clean(orgRow.salesSecondaryTimeZone) ?? null,
      followupOffsetDays: row?.followupOffsetDays ?? null,
      finalPushOffsetDays: row?.finalPushOffsetDays ?? null,
      // Templates + Leads share one resolver with getAutomation() (see below) so the
      // /arsenal/config read and the machine campaign config never drift. PER-ORG.
      ...this.resolveAutomation(orgRow),
    };
  }

  // The KEY of the org's default sender. The org's OWN sender flagged isDefault wins
  // (only authoritative when the list is the org's own rows, NOT the product fallback);
  // else the stored org_config.defaultSender free-text key; else the first resolved
  // sender's key; else null. `fromOrg` distinguishes a real org list from the
  // DEFAULT_SENDERS fallback so an explicit defaultSender pref isn't overridden by the
  // product list's baked-in isDefault flag.
  private resolveDefaultSenderKey(
    orgRow: OrgConfigRow,
    senders: OrgSenderDto[],
    fromOrg: boolean,
  ): string | null {
    if (fromOrg) {
      const flagged = senders.find((s) => s.isDefault);
      if (flagged) return flagged.key;
    }
    const stored = clean(orgRow.defaultSender);
    if (stored) return stored;
    return senders[0]?.key ?? null;
  }

  // The org's effective sales calendar id: org_config.salesCalendarId ?? env
  // SALES_CALENDAR_ID ?? null (the product default is the LAST fallback).
  private resolveSalesCalendarId(orgRow: OrgConfigRow): string | null {
    return (
      clean(orgRow.salesCalendarId) ??
      clean(this.config.get('SALES_CALENDAR_ID')) ??
      null
    );
  }

  // The effective Templates + Leads groups for a PER-ORG org_config row — the single
  // source of truth shared by getEffective() (the admin /arsenal/config read) and
  // getAutomation() (merged into the machine GET /campaigns/:id/config). Templates are
  // raw stored values, nullable (no env fallback); `defaultTemplate` is jsonb (typed
  // unknown) → surfaced as the DTO shape or null. Leads caps are raw nullable (null =
  // no cap), regions default to []; the two booleans are EFFECTIVE with a safe product
  // default of `true` — an unset (null) value must never read as "off" (so
  // suppressions are honoured and a niche analysis is required until an admin
  // explicitly turns them off).
  private resolveAutomation(row: OrgConfigRow): {
    templates: WorkflowTemplatesDto;
    leads: WorkflowLeadsDto;
  } {
    return {
      templates: {
        default: (row.defaultTemplate ?? null) as DefaultTemplateDto | null,
        signature: clean(row.signature) ?? null,
        signatureImageUrl: clean(row.signatureImageUrl) ?? null,
        tone: (clean(row.tone) ?? null) as OutreachTone | null,
        language: (clean(row.templateLanguage) ?? null) as TemplateLanguage | null,
      },
      leads: {
        maxLeadsPerRun: row.maxLeadsPerRun ?? null,
        maxPerNiche: row.maxPerNiche ?? null,
        dailySendCap: row.dailySendCap ?? null,
        defaultRegions: row.defaultRegions ?? [],
        respectSuppressions: row.respectSuppressions ?? true,
        dedupDays: row.dedupDays ?? null,
        requireNicheAnalysis: row.requireNicheAnalysis ?? true,
      },
    };
  }

  // The effective automation block for ONE org, merged into the machine GET
  // /campaigns/:id/config by CampaignsService so the outreach workflows pick up the
  // baseline copy + lead governance + the org's senders/default-from-address/sales
  // calendar without a new HTTP node. Templates + Leads resolve identically to
  // getEffective() (same org row + the same gate defaults) via resolveAutomation();
  // the senders/defaultSenderEmail/salesCalendarId fields use the same resolvers
  // getEffective() does, so the admin read and the machine config never drift.
  async getAutomation(orgId: string): Promise<ResolvedAutomation> {
    const orgRow = await this.orgRow(orgId);
    const { senders, fromOrg } = await this.senders.resolveDetailed(orgId);
    const defaultKey = this.resolveDefaultSenderKey(orgRow, senders, fromOrg);
    // The from-address n8n should send as: the resolved default sender's email, or the
    // first resolved sender's email when no key resolves (defensive — should not occur
    // given DEFAULT_SENDERS), else null.
    const defaultSenderEmail =
      senders.find((s) => s.key === defaultKey)?.email ??
      senders[0]?.email ??
      null;
    return {
      ...this.resolveAutomation(orgRow),
      senders,
      defaultSenderEmail,
      salesCalendarId: this.resolveSalesCalendarId(orgRow),
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

  // Apply a partial config update for the caller's org, applying ONLY the provided
  // keys: a value sets it, `null` clears it (→ env for infra / product default for
  // prefs), an omitted key is left unchanged. INFRA fields (webhooks, n8n base,
  // offsets) write the GLOBAL workflow_config singleton; PREF fields (default sender,
  // templates, leads) write that org's org_config row. Returns the freshly resolved
  // config for the org.
  async update(
    patch: UpdateWorkflowConfigDto,
    orgId: string,
  ): Promise<WorkflowConfigDto> {
    // --- GLOBAL infra → workflow_config singleton ---
    const infra: Partial<typeof schema.workflowConfig.$inferInsert> = {};
    if (patch.webhooks) {
      const w = patch.webhooks;
      if ('aim' in w) infra.aimWebhookUrl = w.aim ?? null;
      if ('leadSatellite' in w) infra.leadSatelliteWebhookUrl = w.leadSatellite ?? null;
      if ('ammoForge' in w) infra.ammoForgeWebhookUrl = w.ammoForge ?? null;
      if ('reachBazooka' in w) infra.reachBazookaWebhookUrl = w.reachBazooka ?? null;
      if ('replyGlock' in w) infra.replyGlockWebhookUrl = w.replyGlock ?? null;
      if ('sleeperGrenade' in w) {
        infra.sleeperGrenadeWebhookUrl = w.sleeperGrenade ?? null;
      }
    }
    if ('n8nApiUrl' in patch) infra.n8nApiUrl = patch.n8nApiUrl ?? null;
    if ('followupOffsetDays' in patch) {
      infra.followupOffsetDays = patch.followupOffsetDays ?? null;
    }
    if ('finalPushOffsetDays' in patch) {
      infra.finalPushOffsetDays = patch.finalPushOffsetDays ?? null;
    }

    // --- PER-ORG prefs → org_config(orgId) ---
    const prefs: Partial<typeof schema.orgConfig.$inferInsert> = {};
    if ('defaultSender' in patch) {
      const ds = clean(patch.defaultSender);
      // A non-empty defaultSender must reference one of the org's resolved sender
      // keys (its own rows, or the DEFAULT_SENDERS fallback) — otherwise the config
      // would advertise a default that silently resolves to a different address.
      // A blank/cleared value resets it to the resolver's own default.
      if (ds !== undefined) {
        const keys = (await this.senders.resolve(orgId)).map((s) => s.key);
        if (!keys.includes(ds)) {
          throw new BadRequestException(
            `Unknown sender '${ds}'. Add it under senders before making it the default.`,
          );
        }
      }
      prefs.defaultSender = ds ?? null;
    }
    // The sales calendar id is a PER-ORG pref (value sets / null clears → env/product
    // default). The senders LIST is managed via the dedicated CRUD endpoints, not here.
    if ('salesCalendarId' in patch) {
      prefs.salesCalendarId = patch.salesCalendarId ?? null;
    }
    // The sales-calendar timezones are PER-ORG prefs (a valid IANA zone sets it — the
    // DTO already validated it — null/'' clears: primary → 'Europe/Berlin' default,
    // secondary → no dual-scale gutter).
    if ('salesTimeZone' in patch) {
      prefs.salesTimeZone = patch.salesTimeZone ?? null;
    }
    if ('salesSecondaryTimeZone' in patch) {
      prefs.salesSecondaryTimeZone = patch.salesSecondaryTimeZone ?? null;
    }

    // Templates group — each sub-field independent: a value sets it, null clears it,
    // an omitted key is left unchanged. `default` is stored as the jsonb object (or
    // null to clear the baseline).
    if (patch.templates) {
      const t = patch.templates;
      if ('default' in t) prefs.defaultTemplate = t.default ?? null;
      if ('signature' in t) prefs.signature = t.signature ?? null;
      if ('signatureImageUrl' in t) prefs.signatureImageUrl = t.signatureImageUrl ?? null;
      if ('tone' in t) prefs.tone = t.tone ?? null;
      if ('language' in t) prefs.templateLanguage = t.language ?? null;
    }

    // Leads group — caps: value sets / null clears; defaultRegions replaces the
    // stored array wholesale when provided; the two booleans set directly.
    if (patch.leads) {
      const l = patch.leads;
      if ('maxLeadsPerRun' in l) prefs.maxLeadsPerRun = l.maxLeadsPerRun ?? null;
      if ('maxPerNiche' in l) prefs.maxPerNiche = l.maxPerNiche ?? null;
      if ('dailySendCap' in l) prefs.dailySendCap = l.dailySendCap ?? null;
      if ('defaultRegions' in l && l.defaultRegions !== undefined) {
        prefs.defaultRegions = l.defaultRegions;
      }
      if ('respectSuppressions' in l && l.respectSuppressions !== undefined) {
        prefs.respectSuppressions = l.respectSuppressions;
      }
      if ('dedupDays' in l) prefs.dedupDays = l.dedupDays ?? null;
      if ('requireNicheAnalysis' in l && l.requireNicheAnalysis !== undefined) {
        prefs.requireNicheAnalysis = l.requireNicheAnalysis;
      }
    }

    if (Object.keys(infra).length > 0) {
      await this.persist(infra);
      this.invalidate();
    }
    if (Object.keys(prefs).length > 0) {
      await this.persistOrg(orgId, prefs);
    }
    return this.getEffective(orgId);
  }

  // Set (or clear, with url=null) the PER-ORG signature image URL on org_config.
  // Used by SignatureAssetsService so an upload / Drive-link / clear writes the same
  // org_config.signatureImageUrl column the templates group resolves from — keeping
  // the signature image a PER-ORG pref, never global infra. Returns nothing; callers
  // read it back via getEffective() / getAutomation().
  async setSignatureImageUrl(orgId: string, url: string | null): Promise<void> {
    await this.persistOrg(orgId, { signatureImageUrl: url });
  }

  // The caller org's resolved AI engine config: the per-org model + gateway override
  // (org_config.ai_model / ai_gateway), each null when unset. Null on model means the
  // resolver falls back to env ANTHROPIC_MODEL at use-time (see PerformanceService).
  async getAiEngine(orgId: string): Promise<AiEngineConfigDto> {
    const orgRow = await this.orgRow(orgId);
    return {
      model: clean(orgRow.aiModel) ?? null,
      gateway: clean(orgRow.aiGateway) ?? null,
    };
  }

  // Apply a partial AI engine update for the caller's org: a value sets it, null/""
  // clears it back to the product default, an omitted field is unchanged. Empty
  // strings are cleaned to null. Returns the freshly resolved config.
  async updateAiEngine(
    orgId: string,
    patch: UpdateAiEngineDto,
  ): Promise<AiEngineConfigDto> {
    const set: Partial<typeof schema.orgConfig.$inferInsert> = {};
    if ('model' in patch) set.aiModel = clean(patch.model) ?? null;
    if ('gateway' in patch) set.aiGateway = clean(patch.gateway) ?? null;
    if (Object.keys(set).length > 0) {
      await this.persistOrg(orgId, set);
    }
    return this.getAiEngine(orgId);
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

  // Find-or-create the GLOBAL singleton row and apply the partial set. `updatedAt` is
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

  // Find-or-create the PER-ORG org_config row and apply the partial set. `updatedAt`
  // is always bumped. Reads the row directly (not the orgRow find-or-create) so the
  // org-scoped write mirrors persist()'s direct-read semantics.
  private async persistOrg(
    orgId: string,
    set: Partial<typeof schema.orgConfig.$inferInsert>,
  ): Promise<void> {
    const rows = await this.db
      .select()
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    const existing = rows[0];
    if (existing) {
      await this.db
        .update(schema.orgConfig)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(schema.orgConfig.id, existing.id));
    } else {
      await this.db
        .insert(schema.orgConfig)
        .values({ organizationId: orgId, ...set });
    }
  }
}
