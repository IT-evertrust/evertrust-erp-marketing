import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';

// Engage knowledge base: company documents (PDF/Word/sheets/text/scanned images)
// uploaded by the operator. When a reply is classified UNSURE, the drafter searches
// `extractedText` (Postgres full-text search) for relevant company info and grounds a
// better reply on the matches (with citations). `status` reflects text extraction:
// READY = text extracted & searchable, NO_TEXT = stored but no text found (e.g. an
// image with no OCR result), FAILED = extraction errored (file still stored).
export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    // The extracted, searchable plain text (empty when none could be extracted).
    extractedText: text('extracted_text').notNull().default(''),
    status: text('status').notNull().default('READY'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('knowledge_documents_org_idx').on(t.organizationId)],
);
