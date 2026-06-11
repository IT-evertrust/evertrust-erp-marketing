import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

type TenderRow = typeof schema.tenders.$inferSelect;
type LineItemRow = typeof schema.lineItems.$inferSelect;
type PriceObservationRow = typeof schema.priceObservations.$inferSelect;

// Tenancy resolver for the pricing core. line_items / price_observations / pricings
// carry NO organizationId — tenancy is inherited via the owning tender. These
// helpers load the parent tender under tenantScope so EVERY pricing operation can
// reject cross-org access as a 404 before it touches a child row.
@Injectable()
export class PricingTenantService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // Load a tender within the caller's org, or 404. Cross-org is indistinguishable
  // from missing — the desired isolation behavior.
  async requireTender(orgId: string, tenderId: string): Promise<TenderRow> {
    const rows = await this.db
      .select()
      .from(schema.tenders)
      .where(
        and(tenantScope(orgId, schema.tenders), eq(schema.tenders.id, tenderId)),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Tender not found');
    return row;
  }

  // Load a line item AND verify its owning tender is in the caller's org. 404 if
  // the line item is missing, or its tender is missing / belongs to another org.
  async requireLineItem(orgId: string, lineItemId: string): Promise<LineItemRow> {
    const rows = await this.db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.id, lineItemId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Line item not found');
    // Confirm the parent tender is in the tenant (throws 404 otherwise).
    await this.requireTender(orgId, row.tenderId);
    return row;
  }

  // Load a price observation AND verify (via its line item -> tender) that it is
  // in the caller's org. Returns the observation; 404 on any cross-org/missing hop.
  async requireObservation(
    orgId: string,
    observationId: string,
  ): Promise<PriceObservationRow> {
    const rows = await this.db
      .select()
      .from(schema.priceObservations)
      .where(eq(schema.priceObservations.id, observationId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Price observation not found');
    // Walk observation -> line item -> tender, enforcing tenancy at the tender.
    await this.requireLineItem(orgId, row.lineItemId);
    return row;
  }
}
