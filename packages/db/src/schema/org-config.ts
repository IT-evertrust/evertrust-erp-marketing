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
import { googleAccounts } from './google-accounts';
import { organizations } from './org';

// PER-ORGANIZATION configuration (multi-tenant SaaS). One row per org — holds the
// CUSTOMER-FACING outreach preferences: templates, signature (+ image), tone,
// language, default sender, and lead governance.
//
// Platform INFRASTRUCTURE (n8n webhook URLs, n8n API base, the ingest token, and
// sequence offsets) deliberately stays in the GLOBAL `workflow_config` singleton:
// there is ONE shared n8n + API for all tenants, OWNER-managed — customers never
// configure the wiring. This split is why the n8n callback token can stay global
// for now (per-org tokens are a later hardening).
//
// Override semantics mirror workflow_config: every column is NULLABLE and null =
// "fall back to the product default", resolved in the service layer.
export const orgConfig = pgTable(
  'org_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // --- Templates (per-org outreach defaults) ---
    // Baseline 3-block sequence:
    //   { cold:{subject,body}, followup:{subject,body}, finalPush:{subject,body} }
    defaultTemplate: jsonb('default_template'),
    // Sign-off block appended to outgoing messages.
    signature: text('signature'),
    // Signature image: a PUBLIC URL embedded in outgoing emails — either an
    // uploaded asset served by the API, or a normalized Drive/lh3 link. Null = none.
    signatureImageUrl: text('signature_image_url'),
    // Outreach tone: 'friendly' | 'formal' | 'direct'. Plain text, not an enum.
    tone: text('tone'),
    // Template language: 'en' | 'de'. Plain text, not an enum.
    templateLanguage: text('template_language'),
    // Default Gmail sending alias for this org (mirrors campaigns.sender — text).
    defaultSender: text('default_sender'),
    // Calendar this org books sales meetings into. Opaque provider id (e.g. a
    // Google Calendar id). Null = fall back to the product default.
    salesCalendarId: text('sales_calendar_id'),
    // IANA timezone the org's sales calendar runs in — drives free-slot business
    // hours, the Activate week grid, and event create/update defaults. Null = fall
    // back to the product default (env SALES_TIME_ZONE ?? 'Europe/Berlin').
    salesTimeZone: text('sales_time_zone'),
    // Optional SECOND IANA timezone shown alongside the primary one (the Activate
    // dual time-scale gutter, e.g. a remote team's zone). Null = no secondary gutter
    // (single-scale calendar). Purely per-org — no product default.
    salesSecondaryTimeZone: text('sales_secondary_time_zone'),
    // Default connected Google account for sending Gmail. Null = none chosen.
    defaultGmailAccountId: uuid('default_gmail_account_id').references(
      () => googleAccounts.id,
    ),
    // Default connected Google account for Calendar operations. Null = none chosen.
    defaultCalendarAccountId: uuid('default_calendar_account_id').references(
      () => googleAccounts.id,
    ),
    // SINGLE org-default Google mailbox — used for BOTH Gmail send and Calendar.
    // Replaces the two-pointer default_gmail/default_calendar model at the app
    // layer (those columns are kept for back-compat but no longer read). Null = none.
    defaultMailboxAccountId: uuid('default_mailbox_account_id').references(
      () => googleAccounts.id,
    ),
    // Per-org AI model preference (e.g. 'claude-opus-4-8'). Null = product default
    // (env ANTHROPIC_MODEL).
    aiModel: text('ai_model'),
    // Per-org AI gateway label (e.g. 'LiteLLM · Mac mini'). Null = default.
    aiGateway: text('ai_gateway'),
    // Per-org Python-agent LLM gateway base URL (e.g. 'https://…/v1'). Drives the
    // erp-agents (lead satellite, etc.) per org. Null = env LLM_BASE_URL default.
    agentLlmBaseUrl: text('agent_llm_base_url'),
    // Per-org Python-agent model (e.g. 'hermes'). Null = env EXTRACT_MODEL default.
    // The agent API KEY is never stored per-org — it resolves from env LLM_API_KEY.
    agentLlmModel: text('agent_llm_model'),
    // Per-org Lead Scraper tuning — admin-set from the Configuration page, passed to
    // the satellite agent per run (request value ?? agent env default). Null = the
    // agent's own env default (LEAD_TARGET / LEAD_MAX_QUERIES / LEAD_MIN_KEEP_SCORE).
    // scrapeLeadTarget: how many leads to hunt for; scrapeMaxQueries: search budget
    // (speed vs coverage); scrapeMinScore: the tier-floor (drops leads scoring below it).
    scrapeLeadTarget: integer('scrape_lead_target'),
    scrapeMaxQueries: integer('scrape_max_queries'),
    scrapeMinScore: integer('scrape_min_score'),
    // --- Reach send policy (per-org override of the env default) ---
    // 'test' redirects every Reach email to reachTestRecipient (capped by
    // reachTestSendCap) with a banner so real leads are never hit; 'live' sends to
    // the real lead email. Null = fall back to env REACH_SEND_MODE (default 'test').
    // Editable from the Settings page without a redeploy.
    reachSendMode: text('reach_send_mode'),
    // Inbox that test-mode Reach emails are redirected to. Null = env
    // REACH_TEST_RECIPIENT default.
    reachTestRecipient: text('reach_test_recipient'),
    // Max test-mode sends per delivery run. Null = env REACH_TEST_SEND_CAP default.
    reachTestSendCap: integer('reach_test_send_cap'),
    // --- Lead governance (per-org) ---
    maxLeadsPerRun: integer('max_leads_per_run'),
    maxPerNiche: integer('max_per_niche'),
    dailySendCap: integer('daily_send_cap'),
    defaultRegions: text('default_regions').array().default([]),
    respectSuppressions: boolean('respect_suppressions'),
    dedupDays: integer('dedup_days'),
    requireNicheAnalysis: boolean('require_niche_analysis'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('org_config_organization_id_uq').on(t.organizationId)],
);
