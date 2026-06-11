import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';

// Coaching personas (the lens the Sales-Agent analysis is run through). ERP-
// managed: each carries the system prompt sent to Claude. The org is
// auto-provisioned a default "Alex Hormozi" persona on first read.
export const personas = pgTable(
  'personas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('personas_organization_id_idx').on(t.organizationId)],
);
