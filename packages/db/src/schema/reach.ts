import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { campaigns } from './campaigns';
import { personas } from './personas';
import { pipelineStageEnum } from './enums';

// Reach (Growth Engine) owns its own lean tables, separate from the heavier
// campaigns/prospects pipeline. An "aim" is a Reach campaign: the AIM input
// fields ARE the config.json, and the generated templates + news brief live on
// the row. Leads found by Lead Satellite are tied to the aim.

export const reachAimStatusEnum = pgEnum('reach_aim_status', [
  'DRAFT', // created, nothing generated yet
  'READY', // templates + news generated (Ammo Forge done)
  'RUNNING', // Lead Satellite scraping
  'COMPLETED', // leads stored
  'FAILED',
]);

export const reachLeadStatusEnum = pgEnum('reach_lead_status', [
  'NEW',
  'COLD_OUTREACHED',
  'FOLLOWED_UP',
  'INTERESTED',
  'UNSURE',
  'NOT_INTERESTED',
]);

export const reachRoundEnum = pgEnum('reach_round', [
  'cold',
  'followup',
  'final',
]);

type EmailBlock = { subject: string; body: string };
type ReachTemplates = {
  cold_outreach: EmailBlock;
  follow_up: EmailBlock;
  final_push: EmailBlock;
};
type ReachNewsBrief = { title: string; body: string };
// Per-round outreach stats. `sent` is real (driven by the Send action); the rest
// stay 0 until open/click/bounce/reply/meeting tracking exists.
type RoundStats = {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  meetings: number;
};
type ReachStats = { cold: RoundStats; followup: RoundStats; final: RoundStats };

export const reachAims = pgTable(
  'reach_aims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: every aim belongs to exactly one org.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // The CRM campaign this aim feeds (the Reach→Nurture bridge). NULLABLE: an aim
    // gets a campaign lazily, the first time one of its leads is promoted into the
    // Nurture pipeline (find-or-created 1:1 from the aim). Until then it's a
    // self-contained Reach campaign with no CRM home.
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    // ---- config.json (the AIM input fields) ----
    name: text('name').notNull(),
    niche: text('niche').notNull(),
    region: text('region').notNull(),
    segment: text('segment'),
    source: text('source'),
    // Which mailbox the campaign sends from (info | hanna) -> a connected
    // google_accounts row (resolved by email) for real Gmail delivery.
    sender: text('sender').notNull().default('info'),
    // ---- generated assets ----
    status: reachAimStatusEnum('status').notNull().default('DRAFT'),
    // Ammo Forge output: cold / follow-up / final-push email blocks.
    templates: jsonb('templates').$type<ReachTemplates>(),
    // The news.doc — LLM demand-driver brief (or offline scaffold).
    newsBrief: jsonb('news_brief').$type<ReachNewsBrief>(),
    // Per-round send/engagement stats (denormalized cache, recomputed from
    // reach_sends on each send/tracking event).
    stats: jsonb('stats').$type<ReachStats>(),
    // 'llm' when a model produced the content, 'offline' for the fallback.
    generatedBy: text('generated_by'),
    // Engage drafting persona: reply_glock writes replies in this salesperson's
    // voice/pattern (the same `personas` Activate uses for call coaching). Null =
    // the default EVERTRUST voice.
    personaId: uuid('persona_id').references(() => personas.id),
    // Reach Bazooka on/off toggle: when true, the auto-sender advances this
    // campaign's sequence on each run.
    autoSend: boolean('auto_send').notNull().default(false),
    // Count of leads found (denormalized for the campaign table).
    companies: integer('companies').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('reach_aims_organization_id_idx').on(t.organizationId),
    index('reach_aims_campaign_id_idx').on(t.campaignId),
  ],
);

export const reachLeads = pgTable(
  'reach_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    aimId: uuid('aim_id')
      .notNull()
      .references(() => reachAims.id, { onDelete: 'cascade' }),
    company: text('company').notNull(),
    website: text('website'),
    contactName: text('contact_name'),
    contactTitle: text('contact_title'),
    email: text('email'),
    phone: text('phone'),
    location: text('location'),
    source: text('source'),
    qualificationReason: text('qualification_reason'),
    // 0.0-1.0 fit score from the agent.
    confidence: doublePrecision('confidence'),
    // Outreach progress (driven by the send sequence + reply classification).
    status: reachLeadStatusEnum('status').notNull().default('NEW'),
    // Nurture SALES funnel stage — orthogonal to `status` (outreach) above. The Reach
    // lead IS the Nurture pipeline card now (no separate prospects table); every lead
    // starts at INTEREST and is dragged across the six stages on the Nurture board.
    pipelineStage: pipelineStageEnum('pipeline_stage')
      .notNull()
      .default('INTEREST'),
    // Deal value in whole euros, shown + inline-edited on the Nurture card. Auto-set
    // from meeting pricing (Activate after-sales) by company match.
    dealValue: integer('deal_value').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('reach_leads_aim_id_idx').on(t.aimId),
    index('reach_leads_organization_id_idx').on(t.organizationId),
  ],
);

// One row per (lead, round): the send event + open/click/reply timestamps. The
// source of truth for per-round stats and the daily send timeline. Written by the
// manual Send action and by Reach Bazooka; updated by the tracking endpoints.
export const reachSends = pgTable(
  'reach_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    aimId: uuid('aim_id')
      .notNull()
      .references(() => reachAims.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => reachLeads.id, { onDelete: 'cascade' }),
    round: reachRoundEnum('round').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('reach_sends_lead_round_uq').on(t.leadId, t.round),
    index('reach_sends_aim_id_idx').on(t.aimId),
    index('reach_sends_organization_id_idx').on(t.organizationId),
  ],
);
