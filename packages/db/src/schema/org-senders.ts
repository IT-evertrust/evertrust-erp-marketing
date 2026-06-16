import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { googleAccounts } from './google-accounts';
import { organizations } from './org';

// PER-ORGANIZATION email senders. One row per from-address an org is allowed to
// send as. A campaign references one of these by its stable `sender_key`
// (mirrors campaigns.sender — text), so the resolved from-address can change
// without rewriting campaigns.
//
// The key is org-scoped and stable: e.g. 'info', 'hanna', or a customer's own
// key/slug. UNIQUE (organization_id, sender_key) guarantees a key resolves to at
// most one address per org. Many senders per org are allowed, so the index on
// organization_id is a plain (non-unique) btree.
//
// No rows are seeded: the API resolver falls back to product defaults when an org
// has no senders, so no evertrust-specific addresses are baked into the DB.
export const orgSenders = pgTable(
  'org_senders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Stable key referenced by campaigns.sender — e.g. 'info', 'hanna', or a
    // customer's own key/slug. Org-scoped and unique within the org.
    senderKey: text('sender_key').notNull(),
    // The from-address this key resolves to.
    email: text('email').notNull(),
    // Human-friendly display label, if any.
    label: text('label'),
    // Whether this is the org's default sender. Plain flag — the resolver picks it
    // when a campaign names no sender.
    isDefault: boolean('is_default').notNull().default(false),
    // Connected Google account backing this sender (null = bare alias as today).
    googleAccountId: uuid('google_account_id').references(
      () => googleAccounts.id,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('org_senders_organization_id_sender_key_uq').on(
      t.organizationId,
      t.senderKey,
    ),
    index('org_senders_organization_id_idx').on(t.organizationId),
  ],
);
