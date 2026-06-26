import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { departmentEnum, userPositionEnum, userRoleEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: every user belongs to exactly one organization.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    role: userRoleEnum('role').notNull().default('EMPLOYEE'),
    // Department (org unit) the user belongs to — orthogonal to the role tier,
    // NULLABLE (e.g. a CEO spanning the whole company has none).
    department: departmentEnum('department'),
    // Job title — orthogonal to role + department, NULLABLE, descriptive only.
    position: userPositionEnum('position'),
    // Per-user permission override (array of permission keys). NULL = follow the
    // role's defaults; effective permissions are computed in @evertrust/shared.
    permissions: text('permissions').array(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    // Contact phone — NULLABLE, descriptive only.
    phone: text('phone'),
    active: boolean('active').notNull().default(true),
    // Forced-logout watermark: any session JWT issued (iat) BEFORE this instant is
    // rejected by JwtStrategy, so the user must sign in again — while a fresh login
    // still works (the new token's iat is later). NULL = never force-logged-out.
    // Set when an admin removes the user's connected Google account from Settings.
    tokenInvalidBefore: timestamp('token_invalid_before', { withTimezone: true }),
    // Per-user sender identity — each user's own From display name, signature block,
    // and signature image. These drive the send path per sending user (no org
    // fallback). All NULLABLE: unset = the user simply sends with no custom value.
    senderName: text('sender_name'),
    signature: text('signature'),
    signatureImageUrl: text('signature_image_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    index('users_organization_id_idx').on(t.organizationId),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. Child tables that reference a customer inherit tenancy
    // from it and do NOT carry their own organizationId.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    contact: text('contact'),
    niches: text('niches').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('customers_organization_id_idx').on(t.organizationId)],
);
