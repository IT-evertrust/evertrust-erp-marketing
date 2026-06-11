import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CreateRfqDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { AppConfigService } from '../config/app-config.service';
import { PricingTenantService } from '../pricing/pricing-tenant.service';

type RfqRow = typeof schema.rfqs.$inferSelect;
type SupplierRow = typeof schema.suppliers.$inferSelect;
type LineItemRow = typeof schema.lineItems.$inferSelect;

// Phase 5c — Hermes supplier RFQ. Fires the Hermes n8n webhook to email an RFQ to
// selected suppliers for selected line items of a tender, and records the dispatch
// in `rfqs`. ERP-first + observable, exactly like the arsenal: the webhook call is
// best-effort (DISPATCHED on 2xx, FAILED otherwise) and NEVER 500s on an operational
// failure — the row is written either way. A blank webhook URL is a SETUP error
// (400, no row, no misleading "sent" record). Supplier replies are recorded later
// as SUPPLIER_QUOTE price observations (the normal evidence path), not here.
@Injectable()
export class RfqService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
    private readonly tenant: PricingTenantService,
  ) {}

  // RFQs dispatched for a tender, newest-first. 404 if the tender isn't in the org.
  async list(orgId: string, tenderId: string): Promise<RfqRow[]> {
    await this.tenant.requireTender(orgId, tenderId);
    return this.db
      .select()
      .from(schema.rfqs)
      .where(
        and(tenantScope(orgId, schema.rfqs), eq(schema.rfqs.tenderId, tenderId)),
      )
      .orderBy(desc(schema.rfqs.createdAt));
  }

  // Dispatch an RFQ. Validates the tender (org), the suppliers (org) and any chosen
  // line items (must belong to the tender), fires the Hermes webhook, then records
  // the outcome. 400 when Hermes isn't configured or a supplier/line is foreign.
  async create(
    orgId: string,
    tenderId: string,
    userId: string,
    dto: CreateRfqDto,
  ): Promise<RfqRow> {
    const tender = await this.tenant.requireTender(orgId, tenderId);

    // Resolve + validate suppliers against the org. (Load the org's suppliers with a
    // simple eq query, then check the chosen ids in-process — keeps it fake-db
    // testable and rejects any cross-org / unknown supplier.)
    const orgSuppliers = await this.db
      .select()
      .from(schema.suppliers)
      .where(tenantScope(orgId, schema.suppliers));
    const supplierById = new Map(orgSuppliers.map((s) => [s.id, s]));
    const suppliers: SupplierRow[] = [];
    for (const id of dto.supplierIds) {
      const s = supplierById.get(id);
      if (!s) throw new BadRequestException(`Unknown supplier: ${id}`);
      suppliers.push(s);
    }

    // Resolve + validate any chosen line items against the tender.
    const tenderLines = await this.db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.tenderId, tenderId));
    const lineById = new Map(tenderLines.map((l) => [l.id, l]));
    const lineIds = dto.lineItemIds ?? [];
    const lines: LineItemRow[] = [];
    for (const id of lineIds) {
      const l = lineById.get(id);
      if (!l) {
        throw new BadRequestException(`Line item not on this tender: ${id}`);
      }
      lines.push(l);
    }

    const webhookUrl = this.config.get('N8N_HERMES_RFQ_WEBHOOK_URL');
    if (!webhookUrl) {
      throw new BadRequestException(
        'Hermes RFQ is not wired up yet — set N8N_HERMES_RFQ_WEBHOOK_URL (and add a Webhook trigger to the Hermes n8n workflow).',
      );
    }

    const outcome = await this.fire(webhookUrl, {
      tender: {
        id: tender.id,
        vergabeId: tender.vergabeId,
        title: tender.title,
        buyer: tender.buyer,
        regime: tender.regime,
        location: tender.location,
        currency: tender.currency,
      },
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        contact: s.contact,
      })),
      lineItems: lines.map((l) => ({
        id: l.id,
        position: l.position,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
      })),
      note: dto.note ?? null,
    });

    const inserted = await this.db
      .insert(schema.rfqs)
      .values({
        organizationId: orgId,
        tenderId,
        supplierIds: dto.supplierIds,
        lineItemIds: lineIds,
        note: dto.note ?? null,
        status: outcome.status,
        detail: outcome.detail,
        dispatchedBy: userId,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to record RFQ');
    return row;
  }

  // POST the RFQ payload to the Hermes webhook; map the outcome to a status +
  // detail. Best-effort: a non-2xx / network error is FAILED, never a throw.
  private async fire(
    webhookUrl: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: 'DISPATCHED' | 'FAILED'; detail: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return res.ok
        ? { status: 'DISPATCHED', detail: `HTTP ${res.status}` }
        : { status: 'FAILED', detail: `webhook HTTP ${res.status}` };
    } catch (err) {
      return {
        status: 'FAILED',
        detail: err instanceof Error ? err.message : 'webhook call failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
