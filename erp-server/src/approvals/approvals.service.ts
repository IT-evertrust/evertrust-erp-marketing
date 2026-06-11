import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  CreateApprovalRequestDto,
  DecideApprovalDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

// Row type as Drizzle returns it (Date timestamps). The API JSON-serializes these
// to the ApprovalRequestDto wire shape (ISO strings).
type ApprovalRow = typeof schema.approvalRequests.$inferSelect;

// Phase 6 (R30) customer-approval gate. approval_requests carries NO
// organizationId — tenancy is inherited via the owning tender, so every operation
// resolves the parent tender under tenantScope first (cross-org → 404). The HARD
// "no approval → no submission" block itself lives in TendersService.transition;
// this service only records the request and the decision the gate reads.
@Injectable()
export class ApprovalsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // The tender's approval requests, newest-first. 404 if the tender is missing or
  // in another org.
  async listForTender(orgId: string, tenderId: string): Promise<ApprovalRow[]> {
    await this.requireTender(orgId, tenderId);
    return this.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.tenderId, tenderId))
      .orderBy(desc(schema.approvalRequests.requestedAt));
  }

  // Open a PENDING approval request on a tender (default type CUSTOMER). The
  // server owns status (PENDING) and requestedBy; requestedAt defaults in the DB.
  // 404 if the tender is missing / in another org.
  async request(
    orgId: string,
    tenderId: string,
    dto: CreateApprovalRequestDto,
    userId: string,
  ): Promise<ApprovalRow> {
    await this.requireTender(orgId, tenderId);

    const inserted = await this.db
      .insert(schema.approvalRequests)
      .values({
        tenderId,
        type: dto.type,
        status: 'PENDING',
        evidenceUrl: dto.evidenceUrl ?? null,
        requestedBy: userId,
      })
      .returning();

    const row = inserted[0];
    // .returning() yields the inserted row; absence would be a driver-level fault.
    if (!row) throw new Error('Failed to create approval request');
    return row;
  }

  // Record a decision (APPROVED | REJECTED) on an approval request, stamping
  // decidedBy/decidedAt. evidenceUrl, if supplied, overwrites any request-time
  // reference; otherwise the existing one is kept. Returns before/after for audit.
  // 404 if the approval is missing or its tender is in another org.
  async decide(
    orgId: string,
    approvalId: string,
    dto: DecideApprovalDto,
    userId: string,
  ): Promise<{ before: ApprovalRow; after: ApprovalRow }> {
    const before = await this.requireApproval(orgId, approvalId);

    const updated = await this.db
      .update(schema.approvalRequests)
      .set({
        status: dto.decision,
        evidenceUrl: dto.evidenceUrl ?? before.evidenceUrl,
        decidedBy: userId,
        decidedAt: new Date(),
      })
      .where(eq(schema.approvalRequests.id, approvalId))
      .returning();

    const after = updated[0];
    if (!after) throw new NotFoundException('Approval request not found');
    return { before, after };
  }

  // Confirm a tender exists in the caller's org, or 404. Cross-org is
  // indistinguishable from missing — the desired isolation behavior.
  private async requireTender(orgId: string, tenderId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(schema.tenders)
      .where(
        and(tenantScope(orgId, schema.tenders), eq(schema.tenders.id, tenderId)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Tender not found');
  }

  // Load an approval AND verify (via its owning tender) it is in the caller's org.
  // 404 on any missing / cross-org hop.
  private async requireApproval(
    orgId: string,
    approvalId: string,
  ): Promise<ApprovalRow> {
    const rows = await this.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, approvalId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Approval request not found');
    // Enforce tenancy at the parent tender (throws 404 otherwise).
    await this.requireTender(orgId, row.tenderId);
    return row;
  }
}
