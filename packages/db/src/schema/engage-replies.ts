import {
  boolean,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { reachAims } from './reach';
import { reachLeads } from './reach';

// Persisted Engage reply classifications for the CAMPAIGN-centric flow (reach_aims /
// reach_leads model). One row per (aim, lead): the result of running the reply_glock
// agent over that lead's Gmail thread — its category, the AI draft, and the rendered
// thread snapshot. Classification is slow (~35s/lead on the local Hermes), so the
// Engage "scan" writes these once and the reply-sorter reads them instantly.
export const reachLeadReplies = pgTable(
  'reach_lead_replies',
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
    // The Gmail thread this classification is for (so a re-scan can detect new replies).
    gmailThreadId: text('gmail_thread_id'),
    // INTERESTED | UNSURE | TEMPORARY | UNINTERESTED (reply_glock status).
    category: text('category').notNull(),
    confidence: doublePrecision('confidence'),
    reasoning: text('reasoning'),
    // reply_glock recommended_action (SEND_REPLY | SAVE_DRAFT | SNOOZE_FOLLOW_UP | ...).
    recommendedAction: text('recommended_action'),
    // The latest inbound message (what the lead actually said).
    inboundSubject: text('inbound_subject'),
    inboundBody: text('inbound_body'),
    // The AI-drafted reply (editable in the UI before sending).
    draftSubject: text('draft_subject'),
    draftBody: text('draft_body'),
    // Whether the draft was sourced from the knowledge base (Phase 4) + any citations.
    draftSource: text('draft_source'),
    citations: jsonb('citations'),
    // Rendered thread snapshot ([{direction, header, subject, body}, ...]) for the UI.
    thread: jsonb('thread'),
    // For TEMPORARY: the follow-up window the lead suggested.
    followUpWindow: text('follow_up_window'),
    // Operator state: a reply has been sent for this thread.
    handled: boolean('handled').notNull().default(false),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    classifiedAt: timestamp('classified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('reach_lead_replies_aim_lead_uq').on(t.aimId, t.leadId)],
);
