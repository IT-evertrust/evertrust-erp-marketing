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
import { campaigns } from './campaigns';
import { leads } from './leads';

// Sales-Agent meetings: Read.ai calls analyzed by the EVERTRUST - SALES AGENT
// n8n workflow (Hormozi coach), synced into the ERP. Each is attributed to the
// campaign that sourced it by matching the prospect email to a lead
// (leads.campaignId). `analysis` holds the workflow's Sales Analysis Schema JSON
// verbatim; `score` mirrors performance_score.overall for cheap list sorting.
export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Idempotency key for re-syncs. For Read AI meetings this is a deterministic
    // (title, date) key so the Gmail-harvest path (summary) and the MCP path
    // (transcript) converge on the SAME row.
    sessionId: text('session_id'),
    // The Read AI meeting ULID when known (from the MCP path); null for email-harvested.
    readAiId: text('read_ai_id'),
    title: text('title'),
    clientCompany: text('client_company'),
    aeName: text('ae_name'),
    clientContact: text('client_contact'),
    clientEmail: text('client_email'),
    meetingDate: text('meeting_date'),
    persona: text('persona'),
    analysis: jsonb('analysis'),
    // Read AI's own summary (from the report email), shown until our coaching analysis runs.
    summary: text('summary'),
    // Raw transcript (kept so the ERP can re-analyze under a chosen persona).
    transcript: text('transcript'),
    docUrl: text('doc_url'),
    score: integer('score'),
    // Campaign attribution (email → lead → campaign). Nullable = Unattributed.
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    leadId: uuid('lead_id').references(() => leads.id),
    // How the campaign was resolved: 'email' | 'domain' | 'manual' | null.
    matchMethod: text('match_method'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('meetings_organization_id_idx').on(t.organizationId),
    index('meetings_campaign_id_idx').on(t.campaignId),
    uniqueIndex('meetings_org_session_uq').on(t.organizationId, t.sessionId),
  ],
);
