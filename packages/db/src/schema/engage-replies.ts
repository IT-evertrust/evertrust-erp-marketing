import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { meetings } from './meetings';
import { organizations } from './org';
import { personas } from './personas';
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
    // Per-email drafting persona OVERRIDE. null = use the campaign's persona (or the
    // default Hanna voice). Set when the operator picks a persona for this specific
    // reply in the reply detail; the draft is re-drafted in that voice on demand.
    personaId: uuid('persona_id').references(() => personas.id),
    // Rendered thread snapshot ([{direction, header, subject, body}, ...]) for the UI.
    thread: jsonb('thread'),
    // For TEMPORARY: the follow-up window the lead suggested.
    followUpWindow: text('follow_up_window'),
    // --- meeting loop (propose → accept/counter → book) ---
    // The slots we offered the client (set on a Propose-Times send / a COUNTER round).
    proposedSlots: jsonb('proposed_slots').$type<{ start: string; end: string }[]>(),
    // NONE | PROPOSED | ACCEPTED | COUNTER | BOOKED — drives the reply-card banner.
    meetingStatus: text('meeting_status').notNull().default('NONE'),
    // The Gmail message id of the inbound counter-proposal we last resolved into a
    // COUNTER round. The scan makes the COUNTER resolution idempotent per inbound: while
    // this matches the latest inbound (and status is still COUNTER) it skips re-fetching
    // alternatives and re-drafting.
    counterResolvedInboundId: text('counter_resolved_inbound_id'),
    // The resolved slot to book {start,end} when meetingStatus = ACCEPTED.
    acceptedSlot: jsonb('accepted_slot').$type<{ start: string; end: string }>(),
    // The Activate meeting created when BOOKED — CRM link + idempotency guard.
    bookedMeetingId: uuid('booked_meeting_id').references(() => meetings.id),
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

// "Teach the AI" memory for Engage drafting. Each row is a piece of operator
// feedback the draft agent should ALWAYS apply going forward (e.g. "always quote
// 4-6 week delivery", "never promise certifications we don't have"). Scoped to a
// campaign via aimId, or org-wide when aimId is null. reply_glock reads the active
// notes and injects them into the draft prompt so future drafts "remember".
export const engageTraining = pgTable(
  'engage_training',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Null = applies to every campaign in the org; set = scoped to one campaign.
    aimId: uuid('aim_id').references(() => reachAims.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    // 'feedback' (manual "teach the AI") | 'auto' (learned from an edit/redraft).
    source: text('source').notNull().default('feedback'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('engage_training_org_aim_idx').on(t.organizationId, t.aimId)],
);
