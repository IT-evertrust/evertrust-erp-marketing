import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { users } from './core';
import {
  arsenalRunSourceEnum,
  arsenalRunStatusEnum,
  arsenalStageEnum,
  campaignStatusEnum,
} from './enums';

// Growth-Engine campaign — the "AIM sequence" target. One row per launched attack.
// Org-scoped (own organizationId, like tenders/suppliers/customers). The 9 AIM
// fields mirror the reference Growth-Engine form; on "Lock & Load" the API fires
// the AIM n8n webhook, which provisions the Google Drive campaign folder and
// config.json that the rest of the arsenal (Lead Satellite / Ammo Forge / Reach
// Bazooka / Reply Glock / Sleeper Grenade) then runs against autonomously.
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: every campaign belongs to exactly one org.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Optional human label ("Name this attack"); the others are required AIM inputs.
    name: text('name'),
    niche: text('niche').notNull(),
    target: text('target').notNull(),
    country: text('country').notNull(),
    state: text('state').notNull(),
    project: text('project').notNull(),
    gmailLabel: text('gmail_label').notNull(),
    salesCalendarId: text('sales_calendar_id').notNull(),
    whatsappNumber: text('whatsapp_number').notNull(),
    status: campaignStatusEnum('status').notNull().default('DRAFT'),
    // Populated from the AIM webhook response on a successful deploy.
    driveFolderId: text('drive_folder_id'),
    driveFolderUrl: text('drive_folder_url'),
    // Drive reconcile state. The Drive "Evertrust Campaigns" folder is the source of
    // truth for which campaigns exist. A sync (POST /campaigns/sync, via the
    // erp-campaigns-list n8n webhook) sets driveMissing=true when a DEPLOYED
    // campaign's folder is gone — the row is then archived OUT of the active list
    // (kept for audit, not hard-deleted). driveCheckedAt = when it was last reconciled.
    driveMissing: boolean('drive_missing').notNull().default(false),
    driveCheckedAt: timestamp('drive_checked_at', { withTimezone: true }),
    // Captured when the deploy call errors (status FAILED) — observable failure.
    deployError: text('deploy_error'),
    deployedBy: uuid('deployed_by').references(() => users.id),
    deployedAt: timestamp('deployed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('campaigns_organization_id_idx').on(t.organizationId)],
);

// One row per ERP-initiated arsenal trigger (the "Run now" buttons + the daily
// scheduler) — the observable record of every ERP→n8n hand-off. organizationId is
// nullable: a SCHEDULED global run (e.g. the daily Bazooka send) has no initiating
// org. campaignId is set only for per-campaign stages (Lead Satellite, Ammo Forge).
export const arsenalRuns = pgTable(
  'arsenal_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    stage: arsenalStageEnum('stage').notNull(),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    source: arsenalRunSourceEnum('source').notNull(),
    status: arsenalRunStatusEnum('status').notNull(),
    // Human-readable outcome detail (e.g. "HTTP 200" or the failure reason).
    detail: text('detail'),
    // Optional per-run funnel counts an n8n stage reported via the callback
    // (e.g. { emailsSent: 40 }). Null for ERP-dispatched / pre-Phase-2 runs. The
    // Marketing report sums these per period.
    metrics: jsonb('metrics').$type<Record<string, number>>(),
    // The n8n execution this row was imported from (backfill), for idempotent
    // re-syncs. Null for ERP-dispatched / callback-reported runs.
    n8nExecutionId: text('n8n_execution_id'),
    triggeredBy: uuid('triggered_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('arsenal_runs_organization_id_idx').on(t.organizationId),
    index('arsenal_runs_campaign_id_idx').on(t.campaignId),
    index('arsenal_runs_stage_idx').on(t.stage),
    uniqueIndex('arsenal_runs_n8n_execution_id_uq').on(t.n8nExecutionId),
  ],
);

// Per-org Growth-Engine settings (one row per org). bazookaDailyAt is the
// ERP-editable "HH:MM" daily Reach-Bazooka send time (null = off); bazookaTimezone
// is the IANA zone that time is read in (null = legacy/server-local) — the daily
// scheduler reads both here, so they're changeable in the UI without a redeploy.
export const arsenalSettings = pgTable(
  'arsenal_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bazookaDailyAt: text('bazooka_daily_at'),
    bazookaTimezone: text('bazooka_timezone'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('arsenal_settings_organization_id_uq').on(t.organizationId),
  ],
);
