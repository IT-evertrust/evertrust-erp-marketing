import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';

// Persistent client/company research dossiers (Activate · Company Research). One row per
// (org, company): the richer, internal-data-grounded research — profile / signals / talking
// points PLUS interaction context, a history timeline, and a communication-style MBTI read
// (predicted from the client's own emails/transcripts). Business metrics / external history
// are reserved for a later web-enrichment phase (columns present, filled later).
export const clientResearch = pgTable(
  'client_research',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    company: text('company').notNull(),
    clientEmail: text('client_email'),
    leadId: uuid('lead_id'),
    campaignId: uuid('campaign_id'),
    // --- dossier ---
    profile: jsonb('profile'), // [{label, value}]
    signals: jsonb('signals'), // string[]
    talkingPoints: jsonb('talking_points'), // string[]
    interactionContext: text('interaction_context'),
    history: jsonb('history'), // [{date, kind, summary}]
    // --- personality ---
    mbti: text('mbti'), // 4-letter type, or null when too little signal
    mbtiConfidence: doublePrecision('mbti_confidence'),
    mbtiReasoning: text('mbti_reasoning'),
    personality: jsonb('personality'), // {tone, decisiveness, formality, detail}
    // --- deferred web-enrichment (filled in a later phase) ---
    businessMetrics: jsonb('business_metrics'),
    // --- provenance ---
    sources: jsonb('sources'), // what the research drew from (emails/meetings/web)
    status: text('status').notNull().default('ready'), // 'ready' | 'pending' | 'failed'
    generatedBy: text('generated_by'),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('client_research_org_company_uq').on(t.organizationId, t.company)],
);
