import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CreatePriceObservationDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { PricingTenantService } from './pricing-tenant.service';

type PriceObservationRow = typeof schema.priceObservations.$inferSelect;

@Injectable()
export class ObservationsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tenant: PricingTenantService,
  ) {}

  // List a line item's price observations, newest observation first. Tenant-checked
  // via the line item's owning tender (404 if the line item is not in the org).
  async list(orgId: string, lineItemId: string): Promise<PriceObservationRow[]> {
    await this.tenant.requireLineItem(orgId, lineItemId);
    return this.db
      .select()
      .from(schema.priceObservations)
      .where(eq(schema.priceObservations.lineItemId, lineItemId))
      .orderBy(desc(schema.priceObservations.observedAt));
  }

  // Record a price observation against a line item. createdBy is the authenticated
  // user (provenance). supplierId is optional. Tenant-checked via the line item.
  async create(
    orgId: string,
    lineItemId: string,
    userId: string,
    dto: CreatePriceObservationDto,
  ): Promise<PriceObservationRow> {
    await this.tenant.requireLineItem(orgId, lineItemId);

    const inserted = await this.db
      .insert(schema.priceObservations)
      .values({
        lineItemId,
        supplierId: dto.supplierId ?? null,
        source: dto.source,
        price: dto.price,
        note: dto.note ?? null,
        createdBy: userId,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to create price observation');
    return row;
  }

  // Delete a price observation (tenant-checked via line item -> tender). Returns
  // the deleted row for the audit `before`.
  async remove(orgId: string, id: string): Promise<PriceObservationRow> {
    const before = await this.tenant.requireObservation(orgId, id);
    await this.db
      .delete(schema.priceObservations)
      .where(eq(schema.priceObservations.id, id));
    return before;
  }
}
