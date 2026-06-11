import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenders, users } from './core';
import {
  approvalStatusEnum,
  approvalTypeEnum,
  tenderRegimeEnum,
} from './enums';

// Tenancy is inherited via the parent tender (approvalRequests.tenderId); no own
// organizationId column.
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    type: approvalTypeEnum('type').notNull(),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    evidenceUrl: text('evidence_url'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestedBy: uuid('requested_by').references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('approval_requests_tender_id_idx').on(t.tenderId),
    index('approval_requests_requested_by_idx').on(t.requestedBy),
    index('approval_requests_decided_by_idx').on(t.decidedBy),
  ],
);

// Tenancy is inherited via the parent tender (complianceChecks.tenderId); no own
// organizationId column.
export const complianceChecks = pgTable(
  'compliance_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    regime: tenderRegimeEnum('regime').notNull(),
    s123Pass: boolean('s123_pass').notNull(),
    s124Flags: text('s124_flags').array().notNull().default([]),
    eignungComplete: boolean('eignung_complete').notNull(),
    missingForms: text('missing_forms').array().notNull().default([]),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('compliance_checks_tender_id_idx').on(t.tenderId),
    index('compliance_checks_reviewed_by_idx').on(t.reviewedBy),
  ],
);

// Tenancy is inherited via the parent tender (docPackages.tenderId); no own
// organizationId column.
export const docPackages = pgTable(
  'doc_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    checklist: jsonb('checklist').notNull(),
    missing: text('missing').array().notNull().default([]),
    complete: boolean('complete').notNull().default(false),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('doc_packages_tender_id_idx').on(t.tenderId)],
);

// Tenancy is inherited via the parent tender (submissionReceipts.tenderId); no
// own organizationId column.
export const submissionReceipts = pgTable(
  'submission_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    proofUrl: text('proof_url').notNull(),
    // Phase 7 (R36–R37): immutable snapshot of the document file list at submit
    // time (string[] of document names). NULLABLE for rolling-deploy safety.
    fileList: jsonb('file_list'),
  },
  (t) => [
    index('submission_receipts_tender_id_idx').on(t.tenderId),
    index('submission_receipts_submitted_by_idx').on(t.submittedBy),
  ],
);
