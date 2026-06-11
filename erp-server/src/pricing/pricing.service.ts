import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  computeLinePricing,
  computeTenderRisk,
  type LinePricingDto,
  type PriceSource,
  type PricingSignal,
  type TenderPricingDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { canTransition } from '../tenders/tender-state-machine';
import { PricingTenantService } from './pricing-tenant.service';

type LineItemRow = typeof schema.lineItems.$inferSelect;
type PricingRow = typeof schema.pricings.$inferSelect;

// Parse a postgres numeric string to a number; null/blank -> 0. Used only for the
// money ROLL-UP math — stored values stay strings.
function num(v: string | null | undefined): number {
  const n = Number(v ?? '0');
  return Number.isFinite(n) ? n : 0;
}

// Map a line_items row (Date/string-numeric) to the LineItemDto wire shape.
function toLineItemDto(row: LineItemRow): LinePricingDto['lineItem'] {
  return {
    id: row.id,
    tenderId: row.tenderId,
    sourceDocId: row.sourceDocId,
    parentId: row.parentId,
    position: row.position,
    description: row.description,
    longText: row.longText,
    qty: row.qty,
    unit: row.unit,
    spec: row.spec,
    brand: row.brand,
    std: row.std,
    bidEp: row.bidEp,
    bidGp: row.bidGp,
  };
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tenant: PricingTenantService,
  ) {}

  // Compute the whole-tender pricing view: per-line engine output + rolled-up
  // subtotal/finalPrice + tender risk + signal histogram. Read-only. Tenant-scoped
  // via the tender (404 if not in the org). marginPct/status come from the saved
  // pricings row if present, else defaults (0 / DRAFT).
  async getPricing(orgId: string, tenderId: string): Promise<TenderPricingDto> {
    const tender = await this.tenant.requireTender(orgId, tenderId);

    const lines = await this.db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.tenderId, tenderId))
      .orderBy(asc(schema.lineItems.position));

    const pricing = await this.loadPricing(tenderId);

    const lineDtos: LinePricingDto[] = [];
    const signalCounts = { REAL_QUOTES: 0, MIXED: 0, ESTIMATE_ONLY: 0 };
    const riskInput: { bidGp: number | null; backed: boolean }[] = [];

    for (const line of lines) {
      // Observations newest-first so the engine's equal-weight tie-break (first
      // wins) selects the most recent observation.
      const obsRows = await this.db
        .select()
        .from(schema.priceObservations)
        .where(eq(schema.priceObservations.lineItemId, line.id))
        .orderBy(desc(schema.priceObservations.observedAt));

      const result = computeLinePricing(
        obsRows.map((o) => ({
          source: o.source as PriceSource,
          price: num(o.price),
        })),
      );

      signalCounts[result.signal as PricingSignal] += 1;
      riskInput.push({
        bidGp: line.bidGp === null ? null : num(line.bidGp),
        backed: result.backed,
      });

      lineDtos.push({
        lineItem: toLineItemDto(line),
        suggestedPrice: result.suggestedPrice,
        confidence: result.confidence,
        signal: result.signal,
        ryg: result.ryg,
        backed: result.backed,
        observationCount: obsRows.length,
      });
    }

    const subtotal = lines.reduce((sum, l) => sum + num(l.bidGp), 0);
    const marginPct = pricing ? num(pricing.margin) : 0;
    const finalPrice = subtotal * (1 + marginPct / 100);
    const risk = computeTenderRisk(riskInput);

    return {
      lines: lineDtos,
      subtotal: String(subtotal),
      marginPct,
      finalPrice: String(finalPrice),
      currency: pricing?.currency ?? tender.currency,
      status: pricing?.status ?? 'DRAFT',
      highRisk: risk.highRisk,
      unbackedRatio: risk.unbackedRatio,
      riskReasons: risk.reasons,
      signalCounts,
    };
  }

  // Upsert the tender's pricings row from a margin %. subtotal is RECOMPUTED from
  // the line items (never trusted from the client); finalPrice = subtotal*(1+m/100);
  // status resets to DRAFT (a re-priced tender is no longer FINAL). Returns
  // before/after for audit. Tenant-scoped via the tender.
  async upsertPricing(
    orgId: string,
    tenderId: string,
    marginPct: number,
  ): Promise<{ before: PricingRow | null; after: PricingRow }> {
    const tender = await this.tenant.requireTender(orgId, tenderId);
    const before = await this.loadPricing(tenderId);

    const subtotal = await this.computeSubtotal(tenderId);
    const finalPrice = subtotal * (1 + marginPct / 100);

    let after: PricingRow | undefined;
    if (before) {
      const updated = await this.db
        .update(schema.pricings)
        .set({
          subtotal: String(subtotal),
          margin: String(marginPct),
          finalPrice: String(finalPrice),
          status: 'DRAFT',
        })
        .where(eq(schema.pricings.id, before.id))
        .returning();
      after = updated[0];
    } else {
      const inserted = await this.db
        .insert(schema.pricings)
        .values({
          tenderId,
          status: 'DRAFT',
          subtotal: String(subtotal),
          margin: String(marginPct),
          finalPrice: String(finalPrice),
          currency: tender.currency,
        })
        .returning();
      after = inserted[0];
    }

    if (!after) throw new Error('Failed to upsert pricing');
    return { before, after };
  }

  // Finalize the tender pricing: set the pricings row FINAL + decidedBy/decidedAt,
  // and advance the tender PIC_PRICING -> CUSTOMER_PRICING via the state machine.
  // 404 if no pricing row exists yet; 400 if the tender is not in a state from
  // which CUSTOMER_PRICING is legal. Returns before/after for both audited rows.
  async finalize(
    orgId: string,
    tenderId: string,
    userId: string,
  ): Promise<{
    before: { pricing: PricingRow; status: string };
    after: { pricing: PricingRow; status: string };
  }> {
    const tender = await this.tenant.requireTender(orgId, tenderId);

    const beforePricing = await this.loadPricing(tenderId);
    if (!beforePricing) {
      throw new NotFoundException('No pricing to finalize for this tender');
    }

    const target = 'CUSTOMER_PRICING' as const;
    if (!canTransition(tender.status, target)) {
      throw new BadRequestException(
        `Illegal tender transition: ${tender.status} -> ${target}`,
      );
    }

    const updatedPricing = await this.db
      .update(schema.pricings)
      .set({ status: 'FINAL', decidedBy: userId, decidedAt: new Date() })
      .where(eq(schema.pricings.id, beforePricing.id))
      .returning();
    const afterPricing = updatedPricing[0];
    if (!afterPricing) throw new Error('Failed to finalize pricing');

    const updatedTender = await this.db
      .update(schema.tenders)
      .set({ status: target, updatedAt: new Date() })
      .where(
        and(tenantScope(orgId, schema.tenders), eq(schema.tenders.id, tenderId)),
      )
      .returning();
    const afterTender = updatedTender[0];
    if (!afterTender) throw new NotFoundException('Tender not found');

    return {
      before: { pricing: beforePricing, status: tender.status },
      after: { pricing: afterPricing, status: afterTender.status },
    };
  }

  // Load the (single) pricings row for a tender, or null if not yet priced.
  private async loadPricing(tenderId: string): Promise<PricingRow | null> {
    const rows = await this.db
      .select()
      .from(schema.pricings)
      .where(eq(schema.pricings.tenderId, tenderId))
      .limit(1);
    return rows[0] ?? null;
  }

  // Subtotal = Σ line.bidGp across the tender's line items.
  private async computeSubtotal(tenderId: string): Promise<number> {
    const lines = await this.db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.tenderId, tenderId));
    return lines.reduce((sum, l) => sum + num(l.bidGp), 0);
  }
}
