import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { customers, users } from './core';
import { campaigns } from './campaigns';
import { niches } from './niches';
import { leadSourceEnum, leadStageEnum } from './enums';

// Key Account hot-lead — the CRM entity bridging Arsenal acquisition to ERP
// customers. Mirrors the n8n `hot_leads` sheet row (Company Name, Email, Tier,
// Hot Reason, …) plus ERP pipeline fields. Org-scoped; one row per email per org
// (the dedup key, so re-syncs upsert). A lead graduates to a `customers` row via
// the "Convert to customer" action (or the Pipeline's _t:"cust" rows on backfill),
// which sets `customerId` + stage CUSTOMER.
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Mirror of the n8n hot_leads columns.
    email: text('email').notNull(),
    companyName: text('company_name'),
    companyType: text('company_type'),
    website: text('website'),
    city: text('city'),
    country: text('country'),
    tier: text('tier'),
    // Niche link — only set on MANUAL leads (campaignId NULL); N8N leads
    // resolve their niche via the campaign, so the service nulls this when a
    // campaign is linked.
    nicheId: uuid('niche_id').references(() => niches.id),
    // The n8n "Source Campaign" (= campaign project name) + best-effort ERP link.
    sourceCampaign: text('source_campaign'),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    hotReason: text('hot_reason'),
    leadStatus: text('lead_status'),
    meetingDate: text('meeting_date'),
    detectedAt: timestamp('detected_at', { withTimezone: true }),
    note: text('note'),
    // ERP pipeline.
    stage: leadStageEnum('stage').notNull().default('INTERESTED'),
    customerId: uuid('customer_id').references(() => customers.id),
    source: leadSourceEnum('source').notNull().default('N8N'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('leads_organization_id_idx').on(t.organizationId),
    index('leads_stage_idx').on(t.stage),
    index('leads_campaign_id_idx').on(t.campaignId),
    // One lead per email per org — re-syncs upsert by this key.
    uniqueIndex('leads_organization_id_email_uq').on(t.organizationId, t.email),
  ],
);
