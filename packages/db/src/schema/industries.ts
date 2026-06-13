import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';

// Industry groups niches (one industry → many niches; a niche belongs to at
// most one industry). Org-scoped, used for grouping/search only — NOT
// referenced by lead research. Mirrors the `niches` shape: `slug` is the
// lower/trim dedup key (the unique constraint), `name` keeps the display
// casing.
export const industries = pgTable(
  'industries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: every industry belongs to exactly one org.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('industries_organization_id_slug_uq').on(
      t.organizationId,
      t.slug,
    ),
    index('industries_organization_id_idx').on(t.organizationId),
  ],
);
