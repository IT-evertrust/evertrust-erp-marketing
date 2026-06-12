import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './org';

// Lightweight in-app notification feed. Written by n8n via POST /notifications
// (machine token) and by ERP services; `type` is a free-text discriminator
// (e.g. 'NICHE_ANALYSIS_READY', 'ARSENAL_RUN', 'SYSTEM') and `link` is the ERP
// route the notification opens. The bell UI polls unread (readAt IS NULL).
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: every notification belongs to exactly one org.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('notifications_organization_id_idx').on(t.organizationId),
    // The bell's unread poll: WHERE organization_id = ? AND read_at IS NULL.
    index('notifications_organization_id_read_at_idx').on(
      t.organizationId,
      t.readAt,
    ),
  ],
);
