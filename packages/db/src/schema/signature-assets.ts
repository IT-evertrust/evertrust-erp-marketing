import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';

// PER-ORGANIZATION signature image assets. Stores uploaded signature images so an
// org can embed a hosted image in outgoing emails without depending on an external
// Drive/lh3 link (org_config.signatureImageUrl can then point at an API-served URL
// backed by one of these rows).
//
// The image bytes are kept as base64 TEXT (data_base64) rather than bytea: simple
// and portable across the prod / per-dev / litellm Postgres instances, and trivial
// to hand back as a data URI. Many assets per org are allowed, so the index on
// organization_id is a plain (non-unique) btree.
export const signatureAssets = pgTable(
  'signature_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Image MIME type, e.g. 'image/png' | 'image/jpeg'. Plain text, not an enum.
    mimeType: text('mime_type').notNull(),
    // The image bytes, base64-encoded (no data-URI prefix). Kept as TEXT for
    // portability — see file header.
    dataBase64: text('data_base64').notNull(),
    // Original upload filename, if known.
    filename: text('filename'),
    // Decoded byte size of the image, if known.
    byteSize: integer('byte_size'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('signature_assets_organization_id_idx').on(t.organizationId),
  ],
);
