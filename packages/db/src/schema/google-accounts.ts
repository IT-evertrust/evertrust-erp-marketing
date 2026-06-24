import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './core';
import { organizations } from './org';

// PER-ORGANIZATION connected Google accounts (multi-tenant SaaS). One row per
// Google account an org has connected via the OAuth authorization-code flow —
// many per org are allowed (one per ERP user, carrying that user's role). This is
// distinct from the GIS login (which proves identity only and holds no Google API
// access): these rows carry real, encrypted OAuth tokens for Gmail/Calendar API
// calls scoped to the connecting org.
//
// `user_id` is the ERP user who connected the account; the role is derived from
// that user at read time. Tokens are stored as AES-256-GCM ciphertext — plaintext
// NEVER hits the DB. UNIQUE (organization_id, google_sub) keeps a Google account
// connected at most once per org; the organization_id index is a plain (non-unique)
// btree because many accounts per org are allowed.
export const googleAccounts = pgTable(
  'google_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // The ERP user who connected this account; role derived from this user at read time.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // Google stable account id (the `sub` claim from the returned id_token).
    googleSub: text('google_sub').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    // A distinct hex color auto-assigned from a palette when the account connects.
    // Drives the per-account color-coding of meetings in the Activate calendar and
    // the Engage inbox switcher. Nullable for legacy rows (backfilled lazily).
    color: text('color'),
    // Granted OAuth scopes. Default '{}' (empty array).
    scopes: text('scopes').array().notNull().default([]),
    // AES-256-GCM ciphertext — NEVER plaintext.
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    // Optional short-lived access-token cache (also encrypted).
    accessTokenEnc: text('access_token_enc'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    // 'CONNECTED' | 'REVOKED' | 'ERROR'. Plain text, not an enum.
    status: text('status').notNull().default('CONNECTED'),
    lastError: text('last_error'),
    // ---- Engage real-time scan state ----
    // Last Gmail historyId we've processed for this mailbox. Advanced by both the
    // gmail.watch push handler and the historyId poll fallback; the delta since this
    // value is what triggers a targeted Engage scan. Null = not yet baselined.
    gmailHistoryId: text('gmail_history_id'),
    // When the active gmail.watch registration expires (Google caps watches at ~7
    // days). The renewal scheduler re-registers before this. Null = no active watch.
    gmailWatchExpiration: timestamp('gmail_watch_expiration', {
      withTimezone: true,
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('google_accounts_org_sub_uq').on(t.organizationId, t.googleSub),
    index('google_accounts_organization_id_idx').on(t.organizationId),
  ],
);
