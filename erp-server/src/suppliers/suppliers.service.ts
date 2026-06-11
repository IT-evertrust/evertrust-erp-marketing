import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CreateSupplierDto, UpdateSupplierDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

type SupplierRow = typeof schema.suppliers.$inferSelect;

// Only these columns are client-writable; mapping is explicit so a new column is
// never accidentally exposed for write.
function writableValues(
  dto: CreateSupplierDto | UpdateSupplierDto,
): Partial<typeof schema.suppliers.$inferInsert> {
  const v: Partial<typeof schema.suppliers.$inferInsert> = {};
  if (dto.name !== undefined) v.name = dto.name;
  if (dto.niches !== undefined) v.niches = dto.niches;
  if (dto.capabilities !== undefined) v.capabilities = dto.capabilities;
  if (dto.fitScore !== undefined) v.fitScore = dto.fitScore;
  if (dto.contact !== undefined) v.contact = dto.contact;
  return v;
}

@Injectable()
export class SuppliersService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // List the tenant's suppliers newest-first. Tenant-scoped.
  async list(orgId: string): Promise<SupplierRow[]> {
    return this.db
      .select()
      .from(schema.suppliers)
      .where(tenantScope(orgId, schema.suppliers))
      .orderBy(desc(schema.suppliers.createdAt));
  }

  // Fetch one supplier within the tenant. 404 if missing or other-org.
  async get(orgId: string, id: string): Promise<SupplierRow> {
    const rows = await this.db
      .select()
      .from(schema.suppliers)
      .where(
        and(tenantScope(orgId, schema.suppliers), eq(schema.suppliers.id, id)),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Supplier not found');
    return row;
  }

  // Create a supplier in the caller's tenant; server owns organizationId.
  async create(orgId: string, dto: CreateSupplierDto): Promise<SupplierRow> {
    const inserted = await this.db
      .insert(schema.suppliers)
      .values({ ...writableValues(dto), organizationId: orgId, name: dto.name })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to create supplier');
    return row;
  }

  // Update writable fields. Returns before/after for the audit trail. 404 if
  // missing or other-org.
  async update(
    orgId: string,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<{ before: SupplierRow; after: SupplierRow }> {
    const before = await this.get(orgId, id);

    const updated = await this.db
      .update(schema.suppliers)
      .set(writableValues(dto))
      .where(
        and(tenantScope(orgId, schema.suppliers), eq(schema.suppliers.id, id)),
      )
      .returning();

    const after = updated[0];
    if (!after) throw new NotFoundException('Supplier not found');
    return { before, after };
  }
}
