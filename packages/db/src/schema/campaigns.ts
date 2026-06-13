import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { users } from './core';
import { aiRuns } from './observability';
import { niches } from './niches';
import {
  arsenalRunSourceEnum,
  arsenalRunStatusEnum,
  arsenalStageEnum,
  assetKindEnum,
  campaignStateEnum,
} from './enums';

// Growth-Engine campaign — the "AIM sequence" target. One row per launched attack.
// Org-scoped (own organizationId, like tenders/suppliers/customers). The AIM
// fields mirror the reference Growth-Engine form; on "Lock & Load" the API fires
// the AIM n8n webhook and the arsenal (Lead Satellite / Ammo Forge / Reach
// Bazooka / Reply Glock) then runs against the campaign autonomously. The ERP
// row IS the campaign's identity — Drive only holds generated artifacts.
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
    // The campaign's niche, find-or-created from the AIM form. Replaces the old
    // free-text `niche`/`target` pair — targets now live on niche_targets.
    nicheId: uuid('niche_id')
      .notNull()
      .references(() => niches.id),
    country: text('country').notNull(),
    region: text('region').notNull(),
    project: text('project').notNull(),
    gmailLabel: text('gmail_label').notNull(),
    salesCalendarId: text('sales_calendar_id').notNull(),
    whatsappNumber: text('whatsapp_number').notNull(),
    // Gmail sending alias (the AIM workflow config.json `sender`, e.g. 'info').
    sender: text('sender').notNull().default('info'),
    // Campaign lifecycle: DRAFT until activated; ARCHIVED is the soft delete
    // (archivedAt = when), kept for attribution instead of hard-deleting.
    lifecycle: campaignStateEnum('lifecycle').notNull().default('DRAFT'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Drive ARTIFACT pointers — no longer the campaign's identity. Populated
    // lazily by Ammo Forge via the n8n callback; the old Drive reconcile
    // machinery (driveMissing/driveCheckedAt sync) is retired.
    driveFolderId: text('drive_folder_id'),
    driveFolderUrl: text('drive_folder_url'),
    // Named email/content blocks Ammo Forge generates (keys like coldEmail,
    // slotProposal, meetingConfirmation, newsBrief) — a free-form map so the
    // outreach workflows can read templates straight from the ERP instead of
    // Drive, and add new blocks without a schema change. Nullable: empty until a
    // workflow POSTs the first block. Merged incrementally (POST spreads, never
    // clobbers existing keys).
    templates: jsonb('templates').$type<Record<string, string>>(),
    activatedBy: uuid('activated_by').references(() => users.id),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('campaigns_organization_id_idx').on(t.organizationId),
    index('campaigns_niche_id_idx').on(t.nicheId),
    index('campaigns_lifecycle_idx').on(t.lifecycle),
  ],
);

// Registry of files the Growth-Engine workflows generate INTO Drive (email
// templates, news briefs, niche analyses, coach reports, contract templates).
// Binaries stay in Drive; the ERP owns the pointer (documents.storageUrl
// philosophy). driveFileId is the dedup key, so callback re-deliveries upsert.
// Tenancy is inherited via the parent campaign; no own organizationId column.
export const campaignAssets = pgTable(
  'campaign_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    kind: assetKindEnum('kind').notNull(),
    name: text('name').notNull(),
    driveFileId: text('drive_file_id').notNull(),
    driveUrl: text('drive_url'),
    mimeType: text('mime_type'),
    version: integer('version').notNull().default(1),
    // The AI run that produced this asset (null for hand-uploaded files).
    aiRunId: uuid('ai_run_id').references(() => aiRuns.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_assets_drive_file_id_uq').on(t.driveFileId),
    index('campaign_assets_campaign_id_idx').on(t.campaignId),
  ],
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
    // Immutable snapshot of the config the run used (campaign + niche targets
    // as handed to n8n) — the submissionReceipts.fileList pattern: what the run
    // SAW, even after the campaign is edited later.
    configSnapshot: jsonb('config_snapshot'),
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
