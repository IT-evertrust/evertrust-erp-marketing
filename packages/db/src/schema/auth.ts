import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './core';

// Auth infrastructure kept OUT of the domain `users` table so the domain model
// stays clean. One credential row per user; userId is both PK and FK -> users.id.
// The API layer (argon2) is the only writer/reader of passwordHash.
// Tenancy is inherited via the parent user (authCredentials.userId); no own
// organizationId column.
export const authCredentials = pgTable('auth_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
