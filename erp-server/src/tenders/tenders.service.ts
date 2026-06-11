import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  CreateTenderDto,
  DeadlineRiskDto,
  TenderStatus,
  UpdateTenderDto,
} from '@evertrust/shared';
import { computeDeadlineRisk } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { canTransition } from './tender-state-machine';

// Row type as Drizzle returns it (Date timestamps, string numerics). The API
// JSON-serializes these to the TenderDto wire shape.
type TenderRow = typeof schema.tenders.$inferSelect;

// Writable columns the create/update DTOs can set. Mapping is explicit so a new
// optional column never silently becomes client-writable, and so ISO-string
// timestamps are coerced to Date for the timestamptz columns.
function writableValues(
  dto: CreateTenderDto | UpdateTenderDto,
): Partial<typeof schema.tenders.$inferInsert> {
  const v: Partial<typeof schema.tenders.$inferInsert> = {};
  if (dto.vergabeId !== undefined) v.vergabeId = dto.vergabeId;
  if (dto.source !== undefined) v.source = dto.source;
  if (dto.title !== undefined) v.title = dto.title;
  if (dto.buyer !== undefined) v.buyer = dto.buyer;
  if (dto.customerId !== undefined) v.customerId = dto.customerId;
  if (dto.regime !== undefined) v.regime = dto.regime;
  if (dto.niche !== undefined) v.niche = dto.niche;
  if (dto.estimatedValue !== undefined) v.estimatedValue = dto.estimatedValue;
  if (dto.currency !== undefined) v.currency = dto.currency;
  if (dto.isAboveThreshold !== undefined)
    v.isAboveThreshold = dto.isAboveThreshold;
  if (dto.questionsDeadlineAt !== undefined)
    v.questionsDeadlineAt = new Date(dto.questionsDeadlineAt);
  if (dto.submissionDeadlineAt !== undefined)
    v.submissionDeadlineAt = new Date(dto.submissionDeadlineAt);
  if (dto.location !== undefined) v.location = dto.location;
  return v;
}

@Injectable()
export class TendersService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // List the tenant's tenders newest-first, optionally filtered by status.
  // EVERY query is confined to orgId via tenantScope — no cross-tenant reads.
  async list(orgId: string, status?: TenderStatus): Promise<TenderRow[]> {
    const where = status
      ? and(tenantScope(orgId, schema.tenders), eq(schema.tenders.status, status))
      : tenantScope(orgId, schema.tenders);

    return this.db
      .select()
      .from(schema.tenders)
      .where(where)
      .orderBy(desc(schema.tenders.createdAt));
  }

  // Fetch one tender within the tenant. NotFound if it does not exist OR belongs
  // to another org — the tenant scope makes cross-org access indistinguishable
  // from "missing", which is the desired isolation behavior.
  async get(orgId: string, id: string): Promise<TenderRow> {
    const rows = await this.db
      .select()
      .from(schema.tenders)
      .where(and(tenantScope(orgId, schema.tenders), eq(schema.tenders.id, id)))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Tender not found');
    return row;
  }

  // Create a tender in the caller's tenant. Server owns organizationId and the
  // initial status (NOT_STARTED); the client cannot set either.
  async create(orgId: string, dto: CreateTenderDto): Promise<TenderRow> {
    const inserted = await this.db
      .insert(schema.tenders)
      .values({
        ...writableValues(dto),
        organizationId: orgId,
        status: 'NOT_STARTED',
        vergabeId: dto.vergabeId,
        source: dto.source,
        title: dto.title,
      })
      .returning();

    const row = inserted[0];
    // .returning() yields the inserted row; absence would be a driver-level fault.
    if (!row) throw new Error('Failed to create tender');
    return row;
  }

  // Update writable fields only (never status, never organizationId). Returns
  // both the prior row (audit `before`) and the updated row (response + `after`).
  // 404 if the tender is missing or in another tenant.
  async update(
    orgId: string,
    id: string,
    dto: UpdateTenderDto,
  ): Promise<{ before: TenderRow; after: TenderRow }> {
    const before = await this.get(orgId, id);

    const updated = await this.db
      .update(schema.tenders)
      .set({ ...writableValues(dto), updatedAt: new Date() })
      .where(and(tenantScope(orgId, schema.tenders), eq(schema.tenders.id, id)))
      .returning();

    const after = updated[0];
    if (!after) throw new NotFoundException('Tender not found');
    return { before, after };
  }

  // Move a tender to `to`, enforcing the STATE_MACHINE. 404 if missing/other-org;
  // 400 if the transition is not legal from the current status. Returns the
  // before/after rows for the audit trail.
  async transition(
    orgId: string,
    id: string,
    to: TenderStatus,
  ): Promise<{ before: TenderRow; after: TenderRow }> {
    const before = await this.get(orgId, id);

    if (!canTransition(before.status, to)) {
      throw new BadRequestException(
        `Illegal tender transition: ${before.status} -> ${to}`,
      );
    }

    // Phase 7 (R35–R37): SUBMITTED is reached ONLY through POST /tenders/:id/submit,
    // which enforces the FULL gate (Phase 6 customer approval + Phase 7 conditional
    // QC) AND logs the submission_receipt — so SUBMITTED ⟺ recorded evidence. A
    // direct transition here is refused; the gate lives in SubmissionService.
    if (to === 'SUBMITTED') {
      throw new BadRequestException(
        'Submit via POST /tenders/:id/submit so the proof is logged — a direct transition to SUBMITTED is not allowed.',
      );
    }

    const updated = await this.db
      .update(schema.tenders)
      .set({ status: to, updatedAt: new Date() })
      .where(and(tenantScope(orgId, schema.tenders), eq(schema.tenders.id, id)))
      .returning();

    const after = updated[0];
    if (!after) throw new NotFoundException('Tender not found');
    return { before, after };
  }

  // Phase 6 (R31): the org's at-risk worklist. Maps every tenant tender through
  // the deterministic deadline-risk rule (against a single `now`), keeps only the
  // ones inside the T-2 escalation window (or overdue), and orders most-urgent
  // first. This is the surface the dashboard renders AND n8n Cloud polls to route
  // reminders/escalations — both read the same deterministic computation.
  async deadlineRisk(
    orgId: string,
  ): Promise<{ tender: TenderRow; risk: DeadlineRiskDto }[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(schema.tenders)
      .where(tenantScope(orgId, schema.tenders));

    return rows
      .map((tender) => ({
        tender,
        risk: computeDeadlineRisk(
          tender.submissionDeadlineAt
            ? tender.submissionDeadlineAt.toISOString()
            : null,
          now,
          tender.status,
        ),
      }))
      .filter((r) => r.risk.atRisk)
      .sort((a, b) => (a.risk.daysRemaining ?? 0) - (b.risk.daysRemaining ?? 0));
  }
}
