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
    // Default connected Google account for sending Gmail. Null = none chosen.
    defaultGmailAccountId: uuid('default_gmail_account_id').references(
      () => googleAccounts.id,
    ),
    // Default connected Google account for Calendar operations. Null = none chosen.
    defaultCalendarAccountId: uuid('default_calendar_account_id').references(
      () => googleAccounts.id,
    ),
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
