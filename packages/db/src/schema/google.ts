import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './org';
import { users } from './core';

// A stored Google OAuth grant — "Sign in with Google" + acting on the user's behalf
// (Gmail send/read, Calendar). Keyed by (organizationId, googleSub): one grant per
// Google identity per org. Both tokens are ENCRYPTED at rest (AES-256-GCM,
// GOOGLE_TOKEN_ENC_KEY); the API is the only reader. accessTokenEnc is a short-lived
// cache refreshed on demand from the refresh token. `status`/`lastError` track grant
// health so a revoked/expired token surfaces instead of failing silently.
export const googleAccounts = pgTable(
  'google_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    googleSub: text('google_sub').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    accessTokenEnc: text('access_token_enc'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    status: text('status').notNull().default('CONNECTED'),
    lastError: text('last_error'),
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
