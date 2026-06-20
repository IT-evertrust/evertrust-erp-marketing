import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './org';
import { googleAccounts } from './google';

// The sender mailboxes an org can send outreach from — the DB-driven replacement for the
// hardcoded CAMPAIGN_SENDERS list. `senderKey` is the stable handle stored on
// campaigns.sender ('info'|'hanna'|…); `email`/`label` are the display address; an
// optional googleAccountId ties the mailbox to a stored OAuth grant for sending.
export const orgSenders = pgTable(
  'org_senders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    senderKey: text('sender_key').notNull(),
    email: text('email').notNull(),
    label: text('label'),
    isDefault: boolean('is_default').notNull().default(false),
    googleAccountId: uuid('google_account_id').references(
      () => googleAccounts.id,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('org_senders_organization_id_sender_key_uq').on(
      t.organizationId,
      t.senderKey,
    ),
    index('org_senders_organization_id_idx').on(t.organizationId),
  ],
);

// Per-org Growth Engine configuration (one row per org). Outreach defaults (template,
// signature, tone, send caps), the default Google identities for Gmail/Calendar/mailbox,
// and AI gateway settings. Replaces scattered env defaults with editable, tenant-scoped config.
export const orgConfig = pgTable(
  'org_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    defaultTemplate: jsonb('default_template'),
    signature: text('signature'),
    signatureImageUrl: text('signature_image_url'),
    tone: text('tone'),
    templateLanguage: text('template_language'),
    defaultSender: text('default_sender'),
    maxLeadsPerRun: integer('max_leads_per_run'),
    maxPerNiche: integer('max_per_niche'),
    dailySendCap: integer('daily_send_cap'),
    defaultRegions: text('default_regions')
      .array()
      .default(sql`'{}'::text[]`),
    respectSuppressions: boolean('respect_suppressions'),
    dedupDays: integer('dedup_days'),
    requireNicheAnalysis: boolean('require_niche_analysis'),
    salesCalendarId: text('sales_calendar_id'),
    defaultGmailAccountId: uuid('default_gmail_account_id').references(
      () => googleAccounts.id,
    ),
    defaultCalendarAccountId: uuid('default_calendar_account_id').references(
      () => googleAccounts.id,
    ),
    defaultMailboxAccountId: uuid('default_mailbox_account_id').references(
      () => googleAccounts.id,
    ),
    aiModel: text('ai_model'),
    aiGateway: text('ai_gateway'),
    salesTimeZone: text('sales_time_zone'),
    salesSecondaryTimeZone: text('sales_secondary_time_zone'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('org_config_organization_id_uq').on(t.organizationId),
  ],
);
