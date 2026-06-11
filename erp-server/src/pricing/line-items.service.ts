import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CreateLineItemDto, UpdateLineItemDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { PricingTenantService } from './pricing-tenant.service';

type LineItemRow = typeof schema.lineItems.$inferSelect;
type LineItemInsert = typeof schema.lineItems.$inferInsert;

// Compute the line total bidGp = qty * bidEp as a numeric STRING (so postgres
// numeric precision is preserved end-to-end). Returns null when bidEp is absent —
// an un-priced line has no total. qty defaults to 0 when missing.
function computeBidGp(
  qty: string | null | undefined,
  bidEp: string | null | undefined,
): string | null {
  if (bidEp === null || bidEp === undefined) return null;
  const q = Number(qty ?? '0');
  const ep = Number(bidEp);
  if (!Number.isFinite(q) || !Number.isFinite(ep)) return null;
  return String(q * ep);
}

// Map create/update DTO -> writable line_items columns. Explicit so a new column
// is never silently client-writable. bidGp is NOT here (server-derived).
function writableValues(
  dto: CreateLineItemDto | UpdateLineItemDto,
): Partial<LineItemInsert> {
  const v: Partial<LineItemInsert> = {};
  if (dto.position !== undefined) v.position = dto.position;
  if (dto.description !== undefined) v.description = dto.description;
  if (dto.longText !== undefined) v.longText = dto.longText;
  if (dto.qty !== undefined) v.qty = dto.qty;
  if (dto.unit !== undefined) v.unit = dto.unit;
  if (dto.spec !== undefined) v.spec = dto.spec;
  if (dto.brand !== undefined) v.brand = dto.brand;
  if (dto.std !== undefined) v.std = dto.std;
  if (dto.bidEp !== undefined) v.bidEp = dto.bidEp;
  return v;
}

@Injectable()
export class LineItemsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tenant: PricingTenantService,
  ) {}

  // List a tender's line items by position (ascending). Tenant-scoped via the
  // owning tender (404 if the tender is not in the caller's org).
  async list(orgId: string, tenderId: string): Promise<LineItemRow[]> {
    await this.tenant.requireTender(orgId, tenderId);
    return this.db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.tenderId, tenderId))
      .orderBy(asc(schema.lineItems.position));
  }

  // Create a line item under a tender. qty/unit fall back to DB-satisfying
  // defaults ('0'/'') when omitted; bidGp is derived from qty*bidEp.
  async create(
    orgId: string,
    tenderId: string,
    dto: CreateLineItemDto,
  ): Promise<LineItemRow> {
    await this.tenant.requireTender(orgId, tenderId);

    const inserted = await this.db
      .insert(schema.lineItems)
      .values({
        ...writableValues(dto),
        tenderId,
        position: dto.position,
        description: dto.description,
        // qty/unit are NOT NULL in the DB but optional in the DTO.
        qty: dto.qty ?? '0',
        unit: dto.unit ?? '',
        bidGp: computeBidGp(dto.qty, dto.bidEp),
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to create line item');
    return row;
  }

  // Update writable fields. When bidEp or qty changes, bidGp is recomputed on the
  // server from the EFFECTIVE post-update qty/bidEp. Returns before/after for audit.
  async update(
    orgId: string,
    id: string,
    dto: UpdateLineItemDto,
  ): Promise<{ before: LineItemRow; after: LineItemRow }> {
    const before = await this.tenant.requireLineItem(orgId, id);

    const patch: Partial<LineItemInsert> = writableValues(dto);
    // Recompute the total whenever either factor is touched, using the effective
    // values (incoming where provided, else the existing row).
    if (dto.bidEp !== undefined || dto.qty !== undefined) {
      const effQty = dto.qty !== undefined ? dto.qty : before.qty;
      const effEp = dto.bidEp !== undefined ? dto.bidEp : before.bidEp;
      patch.bidGp = computeBidGp(effQty, effEp);
    }

    const updated = await this.db
      .update(schema.lineItems)
      .set(patch)
      .where(eq(schema.lineItems.id, id))
      .returning();

    const after = updated[0];
    if (!after) throw new NotFoundException('Line item not found');
    return { before, after };
  }

  // Delete a line item (tenant-checked via its tender). Returns the deleted row
  // for the audit `before`. Its price_observations are deleted first so the FK
  // does not block the delete.
  async remove(orgId: string, id: string): Promise<LineItemRow> {
    const before = await this.tenant.requireLineItem(orgId, id);

    await this.db
      .delete(schema.priceObservations)
      .where(eq(schema.priceObservations.lineItemId, id));
    await this.db
      .delete(schema.lineItems)
      .where(eq(schema.lineItems.id, id));

    return before;
  }
}
