import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { documents, suppliers, tenders, users } from './core';
import { organizations } from './org';
import { priceObsSourceEnum, pricingStatusEnum, rfqStatusEnum } from './enums';

// Tenancy is inherited via the parent tender (lineItems.tenderId); no own
// organizationId column.
export const lineItems = pgTable(
  'line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    sourceDocId: uuid('source_doc_id').references(() => documents.id),
    // self-reference: nested/grouped line items (e.g. parent position -> sub items)
    parentId: uuid('parent_id').references((): any => lineItems.id),
    position: text('position').notNull(),
    description: text('description').notNull(),
    longText: text('long_text'),
    qty: numeric('qty').notNull(),
    unit: text('unit').notNull(),
    spec: text('spec'),
    brand: text('brand'),
    std: text('std'),
    bidEp: numeric('bid_ep'),
    bidGp: numeric('bid_gp'),
  },
  (t) => [
    index('line_items_tender_id_idx').on(t.tenderId),
    index('line_items_source_doc_id_idx').on(t.sourceDocId),
    index('line_items_parent_id_idx').on(t.parentId),
  ],
);

// Price evidence for a single line item — the multi-source intake the Phase 5a
// pricing engine reasons over. Tenancy is inherited via lineItem -> tender; no
// own organizationId column. supplierId is NULLABLE (a MANUAL/AI_ESTIMATE/
// COMPETITOR_WINNER observation is not tied to a supplier). The engine that turns
// these rows into a suggested price + confidence + signal lives in
// @evertrust/shared (computeLinePricing); this table is pure evidence.
export const priceObservations = pgTable(
  'price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lineItemId: uuid('line_item_id')
      .notNull()
      .references(() => lineItems.id),
    // NULLABLE: only supplier-sourced observations reference a supplier.
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    source: priceObsSourceEnum('source').notNull(),
    price: numeric('price').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    observedAt: timestamp('observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('price_observations_line_item_id_idx').on(t.lineItemId),
    index('price_observations_supplier_id_idx').on(t.supplierId),
    index('price_observations_created_by_idx').on(t.createdBy),
  ],
);

// Tenancy is inherited via the parent tender (pricings.tenderId); no own
// organizationId column.
export const pricings = pgTable(
  'pricings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    status: pricingStatusEnum('status').notNull().default('DRAFT'),
    subtotal: numeric('subtotal').notNull(),
    margin: numeric('margin').notNull(),
    finalPrice: numeric('final_price').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('pricings_tender_id_idx').on(t.tenderId),
    index('pricings_decided_by_idx').on(t.decidedBy),
  ],
);

// Phase 5c — Hermes supplier RFQ. One row per RFQ the ERP dispatches to suppliers
// (via the Hermes n8n/Gmail webhook) asking them to quote selected line items of a
// tender. Org-scoped (own organizationId, like campaigns) + a tenderId FK.
// supplierIds / lineItemIds are uuid[] SNAPSHOTS of what was asked (no element-level
// FK; validated in the service against the org + tender) — a dispatch log, not a
// live relation. status mirrors the ERP→n8n hand-off (DISPATCHED/FAILED); supplier
// replies come back as SUPPLIER_QUOTE price observations, not on this row.
export const rfqs = pgTable(
  'rfqs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    supplierIds: uuid('supplier_ids').array().notNull().default([]),
    lineItemIds: uuid('line_item_ids').array().notNull().default([]),
    note: text('note'),
    status: rfqStatusEnum('status').notNull(),
    // Human-readable webhook outcome ("HTTP 200" or the failure reason).
    detail: text('detail'),
    dispatchedBy: uuid('dispatched_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('rfqs_organization_id_idx').on(t.organizationId),
    index('rfqs_tender_id_idx').on(t.tenderId),
  ],
);
