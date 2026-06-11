import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// The tenant root. Every org-scoped table (users, tenders, suppliers, customers,
// and the org-level observability tables) carries an organizationId FK back here.
// The app runs single-tenant today (one seeded 'Evertrust GmbH' row) but the
// schema is multi-tenant by construction, so going SaaS needs no migration of
// the tenancy seam itself. Child tables (documents, line_items, pricings, …) do
// NOT carry organizationId — they inherit tenancy via their parent
// tender/supplier/customer.
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('organizations_slug_uq').on(t.slug)],
);
