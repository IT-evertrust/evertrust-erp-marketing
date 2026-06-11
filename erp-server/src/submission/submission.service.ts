import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  computeLinePricing,
  computeTenderRisk,
  qcRequired,
  submissionBlockers,
  type ApprovalType,
  type SubmissionReadinessDto,
  type SubmitTenderDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { PricingTenantService } from '../pricing/pricing-tenant.service';

type SubmissionReceiptRow = typeof schema.submissionReceipts.$inferSelect;

// Phase 7 (R34–R37) — conditional QC gate + the human submission act + evidence
// logging. The submission act stays human (the portal); this service enforces ALL
// gates (Phase 6 customer approval + Phase 7 conditional QC), records the
// submission_receipt (proof + file-list snapshot) and only then advances the tender
// to SUBMITTED — so SUBMITTED ⟺ a logged receipt. Tenancy is via the owning tender
// (PricingTenantService.requireTender). All gate logic is the SHARED pure predicates
// (qcRequired / submissionBlockers) so enforcement here and the web card cannot drift.
@Injectable()
export class SubmissionService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tenant: PricingTenantService,
  ) {}

  // Everything the submission card needs: the gate state (computed exactly as
  // submit() enforces it), the QC requirement + reasons, the proposed file list
  // (current documents) and the logged receipts. 404 if the tender isn't in the org.
  async getReadiness(
    orgId: string,
    tenderId: string,
  ): Promise<SubmissionReadinessDto> {
    const tender = await this.tenant.requireTender(orgId, tenderId);
    const hasCustomerApproval = await this.hasApprovedApproval(
      tenderId,
      'CUSTOMER',
    );
    const qc = await this.qcState(tenderId);
    const highRisk = await this.computeHighRisk(tenderId);
    const documents = await this.documentNames(tenderId);
    const receipts = await this.listReceiptRows(tenderId);

    const req = qcRequired({
      isAboveThreshold: tender.isAboveThreshold,
      highRisk,
      qcRequested: qc.requested,
    });
    const blockers = submissionBlockers({
      status: tender.status,
      hasCustomerApproval,
      qcRequired: req.required,
      hasApprovedQc: qc.approved,
    });

    return {
      status: tender.status,
      hasCustomerApproval,
      qcRequired: req.required,
      qcReasons: req.reasons,
      qcRequestExists: qc.requested,
      hasApprovedQc: qc.approved,
      highRisk,
      blockers,
      canSubmit: blockers.length === 0,
      documents,
      receipts: receipts as unknown as SubmissionReadinessDto['receipts'],
    };
  }

  // The human records the portal submission. Enforces the FULL gate (throws 400 with
  // the blockers if not ready), snapshots the file list, writes the receipt and
  // advances DOCUMENTS → SUBMITTED. Returns the receipt (the immutable evidence).
  async submit(
    orgId: string,
    tenderId: string,
    userId: string,
    dto: SubmitTenderDto,
  ): Promise<SubmissionReceiptRow> {
    const tender = await this.tenant.requireTender(orgId, tenderId);
    const hasCustomerApproval = await this.hasApprovedApproval(
      tenderId,
      'CUSTOMER',
    );
    const qc = await this.qcState(tenderId);
    const highRisk = await this.computeHighRisk(tenderId);

    const req = qcRequired({
      isAboveThreshold: tender.isAboveThreshold,
      highRisk,
      qcRequested: qc.requested,
    });
    const blockers = submissionBlockers({
      status: tender.status,
      hasCustomerApproval,
      qcRequired: req.required,
      hasApprovedQc: qc.approved,
    });
    if (blockers.length > 0) {
      throw new BadRequestException(`Cannot submit: ${blockers.join(' ')}`);
    }

    // Snapshot the file list (client override, else the current document set).
    const fileList =
      dto.fileList && dto.fileList.length > 0
        ? dto.fileList
        : await this.documentNames(tenderId);

    const inserted = await this.db
      .insert(schema.submissionReceipts)
      .values({
        tenderId,
        submittedBy: userId,
        proofUrl: dto.proofUrl,
        fileList,
      })
      .returning();
    const receipt = inserted[0];
    if (!receipt) throw new Error('Failed to record submission receipt');

    // Advance the tender (gate already passed). Done here, not via the generic
    // transition (which now refuses a direct → SUBMITTED), so a receipt always exists.
    await this.db
      .update(schema.tenders)
      .set({ status: 'SUBMITTED', updatedAt: new Date() })
      .where(
        and(tenantScope(orgId, schema.tenders), eq(schema.tenders.id, tenderId)),
      );

    return receipt;
  }

  // ---- helpers ----

  // True iff the tender has an APPROVED approval of the given type.
  private async hasApprovedApproval(
    tenderId: string,
    type: ApprovalType,
  ): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(schema.approvalRequests)
      .where(
        and(
          eq(schema.approvalRequests.tenderId, tenderId),
          eq(schema.approvalRequests.type, type),
          eq(schema.approvalRequests.status, 'APPROVED'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // Whether a QC review was opened (any status) and whether one is APPROVED.
  private async qcState(
    tenderId: string,
  ): Promise<{ requested: boolean; approved: boolean }> {
    const rows = await this.db
      .select()
      .from(schema.approvalRequests)
      .where(
        and(
          eq(schema.approvalRequests.tenderId, tenderId),
          eq(schema.approvalRequests.type, 'QC'),
        ),
      );
    return {
      requested: rows.length > 0,
      approved: rows.some((r) => r.status === 'APPROVED'),
    };
  }

  // Pricing high-risk for the QC trigger — the SAME shared engine the pricing
  // workbench uses (≥35% unbacked or a top-5 line unbacked). Self-contained (loads
  // line items + their observations) to avoid coupling to the pricing module.
  private async computeHighRisk(tenderId: string): Promise<boolean> {
    const lines = await this.db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.tenderId, tenderId));
    if (lines.length === 0) return false;

    const assessed: { bidGp: number | null; backed: boolean }[] = [];
    for (const li of lines) {
      const obs = await this.db
        .select()
        .from(schema.priceObservations)
        .where(eq(schema.priceObservations.lineItemId, li.id));
      const result = computeLinePricing(
        obs.map((o) => ({ source: o.source, price: Number(o.price) })),
      );
      assessed.push({
        bidGp: li.bidGp != null ? Number(li.bidGp) : null,
        backed: result.backed,
      });
    }
    return computeTenderRisk(assessed).highRisk;
  }

  // The original names of all documents attached to the tender (the bid file list).
  private async documentNames(tenderId: string): Promise<string[]> {
    const docs = await this.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.tenderId, tenderId));
    return docs.map((d) => d.originalName);
  }

  // The tender's submission receipts, newest-first.
  private async listReceiptRows(
    tenderId: string,
  ): Promise<SubmissionReceiptRow[]> {
    return this.db
      .select()
      .from(schema.submissionReceipts)
      .where(eq(schema.submissionReceipts.tenderId, tenderId))
      .orderBy(desc(schema.submissionReceipts.submittedAt));
  }
}
