import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { campaigns } from './campaigns';
import { nicheTargets } from './niches';
import { leads } from './leads';
import { pipelineStageEnum, prospectStatusEnum } from './enums';

// Cold-outreach target, written by Lead Satellite via POST /prospects/bulk
// (upsert on the (campaignId, email) key) — the per-campaign leads-sheet
// replacement. `status` is a PROJECTION of the conversation; the append-only
// reply_classifications rows are the evidence behind it. A prospect graduates
// to a CRM lead when INTERESTED: `leadId` is the graduation pointer (mirrors
// the leads.customerId pattern).
export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: every prospect belongs to exactly one org.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    // The niche target archetype Lead Satellite was hunting when it found this
    // prospect (null for legacy/manual imports).
    nicheTargetId: uuid('niche_target_id').references(() => nicheTargets.id),
    email: text('email').notNull(),
    companyName: text('company_name'),
    website: text('website'),
    city: text('city'),
    country: text('country'),
    // Where the prospect was found — anti-fabrication provenance.
    sourceUrl: text('source_url'),
    emailVerified: boolean('email_verified').notNull().default(false),
    status: prospectStatusEnum('status').notNull().default('NEW'),
    // Human sales-pipeline stage (Nurture board, drag-and-drop). A SEPARATE axis
    // from `status`: the team moves a card Interest→…→Won/Lost by hand, while the
    // agents keep driving `status`. New prospects start at INTEREST.
    pipelineStage: pipelineStageEnum('pipeline_stage')
      .notNull()
      .default('INTEREST'),
    // Deal value in whole euros, shown + inline-edited on the Nurture card; the
    // board rolls these up into per-column totals. Manual (the team sets it);
    // default 0 until entered.
    dealValue: integer('deal_value').notNull().default(0),
    // Re-engage no earlier than this (set by a SNOOZE verdict).
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
    followupCount: integer('followup_count').notNull().default(0),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    // Graduation pointer — set when the prospect turns INTERESTED.
    leadId: uuid('lead_id').references(() => leads.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One prospect per email per campaign — bulk upserts dedup by this key.
    uniqueIndex('prospects_campaign_id_email_uq').on(t.campaignId, t.email),
    index('prospects_organization_id_idx').on(t.organizationId),
    index('prospects_status_idx').on(t.status),
    index('prospects_pipeline_stage_idx').on(t.pipelineStage),
    index('prospects_snooze_until_idx').on(t.snoozeUntil),
  ],
);

// Org-wide do-not-contact list — Reach Bazooka's pre-send gate. Replaces the
// Sleeper Grenade copy-then-delete sheet: rows are never deleted, the evidence
// is kept. sourceProspectId points at the prospect whose reply created the
// entry (null for hand-added addresses).
export const suppressions = pgTable(
  'suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: the do-not-contact list is per-org.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    email: text('email').notNull(),
    reason: text('reason'),
    sourceProspectId: uuid('source_prospect_id').references(() => prospects.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('suppressions_organization_id_email_uq').on(
      t.organizationId,
      t.email,
    ),
    index('suppressions_organization_id_idx').on(t.organizationId),
  ],
);
