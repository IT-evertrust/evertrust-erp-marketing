import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiRuns } from './observability';
import { campaignAssets } from './campaigns';
import { prospects } from './prospects';
import {
  messageDirectionEnum,
  messageStatusEnum,
  replyVerdictEnum,
} from './enums';

// The conversation ledger, both directions: Bazooka sends (OUTBOUND) and the
// Gmail poller's replies (INBOUND). bodySnippet is a snippet only — Gmail stays
// the archive. Idempotent on gmailMessageId, so re-polls upsert. Tenancy is
// inherited via the parent prospect (outreachMessages.prospectId); no own
// organizationId column.
export const outreachMessages = pgTable(
  'outreach_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id),
    direction: messageDirectionEnum('direction').notNull(),
    status: messageStatusEnum('status').notNull(),
    gmailMessageId: text('gmail_message_id'),
    gmailThreadId: text('gmail_thread_id'),
    subject: text('subject'),
    bodySnippet: text('body_snippet'),
    // The campaign_assets email template this send used (OUTBOUND only).
    templateAssetId: uuid('template_asset_id').references(
      () => campaignAssets.id,
    ),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    // Captured when a send fails/bounces — observable failure.
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('outreach_messages_gmail_message_id_uq').on(t.gmailMessageId),
    index('outreach_messages_prospect_id_idx').on(t.prospectId),
    index('outreach_messages_gmail_thread_id_idx').on(t.gmailThreadId),
  ],
);

// Append-only AI verdict log: Reply Glock's fast classification plus the RAG
// agent's deeper pass on UNSURE replies. prospects.status is the projection;
// these rows are the evidence. `raw` holds the verbatim model output (the
// meetings.analysis pattern) and `model` feeds the LLM A/B comparisons.
// Tenancy is inherited via the parent prospect; no own organizationId column.
export const replyClassifications = pgTable(
  'reply_classifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id),
    // The INBOUND message this verdict classified (null for legacy imports).
    messageId: uuid('message_id').references(() => outreachMessages.id),
    verdict: replyVerdictEnum('verdict').notNull(),
    // For SNOOZE verdicts: when to re-engage (copied onto the prospect).
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
    model: text('model'),
    raw: jsonb('raw'),
    suggestedReply: text('suggested_reply'),
    aiRunId: uuid('ai_run_id').references(() => aiRuns.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('reply_classifications_prospect_id_idx').on(t.prospectId)],
);
