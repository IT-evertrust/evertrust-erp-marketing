import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { users } from './core';
import { organizations } from './org';
import { auditActorTypeEnum } from './enums';

// APPEND-ONLY by convention: rows in audit_log are never UPDATEd or DELETEd.
// All operational mutations write a new row here via the API layer. No DB-level
// enforcement (no trigger/rule) — enforced in application code only.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. Audit rows are scoped to the acting user's organization.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    actorType: auditActorTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    before: jsonb('before'),
    after: jsonb('after'),
    correlationId: text('correlation_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_actor_id_idx').on(t.actorId),
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_organization_id_idx').on(t.organizationId),
  ],
);

export const workflowExecutions = pgTable(
  'workflow_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. A workflow run belongs to one organization.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    n8nExecutionId: text('n8n_execution_id').notNull(),
    workflowName: text('workflow_name').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    retries: integer('retries').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    error: text('error'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workflow_executions_n8n_execution_id_uq').on(
      t.n8nExecutionId,
    ),
    index('workflow_executions_organization_id_idx').on(t.organizationId),
  ],
);

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. An AI run belongs to one organization.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    taskType: text('task_type').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull(),
    tokensOut: integer('tokens_out').notNull(),
    eurCost: numeric('eur_cost', { precision: 12, scale: 6 }).notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    escalated: boolean('escalated').notNull().default(false),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_runs_organization_id_idx').on(t.organizationId)],
);

// Polymorphic association via (refType, refId) — intentionally NO FK so any
// entity type can be embedded. Requires the pgvector extension.
// Tenancy is inherited via the referenced entity (refType/refId); embeddings do
// NOT carry their own organizationId.
// NOTE: vector dimension 1536 is a PLACEHOLDER; the embedding model and final
// dimension are finalized at milestone M5.
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    model: text('model').notNull(),
    dim: integer('dim').notNull(),
    content: text('content'),
    vector: vector('vector', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('embeddings_ref_idx').on(t.refType, t.refId),
    // HNSW ANN index for cosine similarity search over the embedding vector.
    index('embeddings_vector_hnsw_idx').using(
      'hnsw',
      t.vector.op('vector_cosine_ops'),
    ),
  ],
);
