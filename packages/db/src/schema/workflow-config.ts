import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// GLOBAL, app-wide SINGLETON config for the Growth-Engine workflow wiring. Lets
// admins override what is otherwise env-only (the n8n webhook URLs, the n8n API
// base, the ingest token, and the sequence offsets) from the ERP, without a
// redeploy. The app is single-tenant today, so this config is GLOBAL — there is
// deliberately NO organizationId. A single row is enforced by `singleton` + its
// unique constraint (the find-or-create target).
//
// Override semantics: every override column is NULLABLE, and null means "fall
// back to the env var" — so an empty/unset row is a no-op and the env stays
// authoritative until an admin explicitly overrides a field.
//
// Secrets are NEVER stored here: the n8n API *key* stays in env, and the ingest
// token is kept only as a SHA-256 hex digest (ingestTokenHash) — never the
// token itself.
//
// `defaultSender` mirrors the existing `campaigns.sender` column (a plain text
// alias like 'info'/'hanna'), NOT a pgEnum — the codebase has no sender enum,
// and adding/altering enums on a live DB is avoided per tasks/lessons.md.
export const workflowConfig = pgTable(
  'workflow_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Singleton guard: always true, UNIQUE — so a second row cannot be inserted.
    // The find-or-create upsert targets this column.
    singleton: boolean('singleton').notNull().default(true),
    // n8n webhook URL overrides — one per Growth-Engine workflow. Null = use the
    // corresponding env var.
    aimWebhookUrl: text('aim_webhook_url'),
    leadSatelliteWebhookUrl: text('lead_satellite_webhook_url'),
    ammoForgeWebhookUrl: text('ammo_forge_webhook_url'),
    reachBazookaWebhookUrl: text('reach_bazooka_webhook_url'),
    replyGlockWebhookUrl: text('reply_glock_webhook_url'),
    sleeperGrenadeWebhookUrl: text('sleeper_grenade_webhook_url'),
    // n8n API base URL override (null = env). The API *key* is intentionally NOT
    // stored — it stays in env.
    n8nApiUrl: text('n8n_api_url'),
    // SHA-256 hex digest of the active ingest token (null = use the env
    // ARSENAL_INGEST_TOKEN). Never the token itself.
    ingestTokenHash: text('ingest_token_hash'),
    ingestTokenSetAt: timestamp('ingest_token_set_at', { withTimezone: true }),
    // Default Gmail sending alias (e.g. 'info'). Mirrors campaigns.sender (text,
    // not an enum). Null = env / per-campaign default.
    defaultSender: text('default_sender'),
    // Sequence offsets (days). First follow-up (product default 2) and final
    // push (product default 4). Null = use the env / product default.
    followupOffsetDays: integer('followup_offset_days'),
    finalPushOffsetDays: integer('final_push_offset_days'),
    // --- Configuration > Templates (global outreach defaults) ---
    // Override semantics unchanged: null = fall back to the product default,
    // resolved in the service layer.
    //
    // Baseline 3-block outreach sequence. JSON shape:
    //   {
    //     cold:      { subject: string, body: string },
    //     followup:  { subject: string, body: string },
    //     finalPush: { subject: string, body: string }
    //   }
    defaultTemplate: jsonb('default_template'),
    // Sign-off block appended to outgoing messages.
    signature: text('signature'),
    // Outreach tone: 'friendly' | 'formal' | 'direct'. Plain text, NOT a pgEnum
    // (the project forbids new enums; altering enums on a live DB is avoided).
    tone: text('tone'),
    // Template language: 'en' | 'de'. Plain text, not an enum.
    templateLanguage: text('template_language'),
    // --- Configuration > Leads (lead-generation governance) ---
    // Max leads pulled per generation run.
    maxLeadsPerRun: integer('max_leads_per_run'),
    // Max leads per niche within a run.
    maxPerNiche: integer('max_per_niche'),
    // Hard cap on emails sent per day.
    dailySendCap: integer('daily_send_cap'),
    // Default target regions. Empty array = no region constraint.
    defaultRegions: text('default_regions').array().default([]),
    // Whether to honor the suppression list when generating leads.
    respectSuppressions: boolean('respect_suppressions'),
    // Dedup window (days): re-contact suppression horizon.
    dedupDays: integer('dedup_days'),
    // Whether a niche analysis is required before a run proceeds.
    requireNicheAnalysis: boolean('require_niche_analysis'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('workflow_config_singleton_uq').on(t.singleton)],
);
