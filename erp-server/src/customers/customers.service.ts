import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CreateCustomerDto, UpdateCustomerDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

type CustomerRow = typeof schema.customers.$inferSelect;

// Explicit writable-column mapping; new columns are not client-writable by default.
function writableValues(
  dto: CreateCustomerDto | UpdateCustomerDto,
): Partial<typeof schema.customers.$inferInsert> {
  const v: Partial<typeof schema.customers.$inferInsert> = {};
  if (dto.name !== undefined) v.name = dto.name;
  if (dto.contact !== undefined) v.contact = dto.contact;
  if (dto.niches !== undefined) v.niches = dto.niches;
  return v;
}

@Injectable()
export class CustomersService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // List the tenant's customers newest-first. Tenant-scoped.
  async list(orgId: string): Promise<CustomerRow[]> {
    return this.db
      .select()
      .from(schema.customers)
      .where(tenantScope(orgId, schema.customers))
      .orderBy(desc(schema.customers.createdAt));
  }

  // Fetch one customer within the tenant. 404 if missing or other-org.
  async get(orgId: string, id: string): Promise<CustomerRow> {
    const rows = await this.db
      .select()
      .from(schema.customers)
      .where(
        and(tenantScope(orgId, schema.customers), eq(schema.customers.id, id)),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Customer not found');
    return row;
  }

  // Create a customer in the caller's tenant; server owns organizationId.
  async create(orgId: string, dto: CreateCustomerDto): Promise<CustomerRow> {
    const inserted = await this.db
      .insert(schema.customers)
      .values({ ...writableValues(dto), organizationId: orgId, name: dto.name })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to create customer');
    return row;
  }

  // Update writable fields. Returns before/after for the audit trail. 404 if
  // missing or other-org.
  async update(
    orgId: string,
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<{ before: CustomerRow; after: CustomerRow }> {
    const before = await this.get(orgId, id);

    const updated = await this.db
      .update(schema.customers)
      .set(writableValues(dto))
      .where(
        and(tenantScope(orgId, schema.customers), eq(schema.customers.id, id)),
      )
      .returning();

    const after = updated[0];
    if (!after) throw new NotFoundException('Customer not found');
    return { before, after };
  }
}
