import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  ContractDto,
  CreateContractDto,
  ContractType,
  UpdateContractDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

// A contracts row as returned by Drizzle select/insert/update.
type ContractRow = typeof schema.contracts.$inferSelect;

// Map a DB row -> ContractDto. `value` reads the `contract_value` column; `terms`
// defaults to [] (the column is NOT NULL default [], but coalesce defensively);
// every other nullable column is passed straight through. Timestamps are emitted as
// ISO strings.
function toDto(row: ContractRow): ContractDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    leadId: row.leadId,
    customerId: row.customerId,
    campaignId: row.campaignId,
    templateAssetId: row.templateAssetId,
    signingMeetingId: row.signingMeetingId,
    status: row.status,
    driveFileId: row.driveFileId,
    driveUrl: row.driveUrl,
    cooperationTerm: row.cooperationTerm,
    company: row.company,
    sector: row.sector,
    value: row.value ?? null,
    deadline: row.deadline,
    contractType: (row.contractType as ContractType | null) ?? null,
    analysis: row.analysis,
    terms: row.terms ?? [],
    signedAt: row.signedAt ? row.signedAt.toISOString() : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

// The Contract Generator (Contract Assist) backing store. Every query is confined to
// the caller's org via tenantScope(orgId, contracts) — a contract can never be read,
// edited, or deleted across tenants. The DB client is global (DbModule), injected
// under the DB token.
@Injectable()
export class ContractsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // The org's contracts, newest first. Optionally narrowed to one campaign.
  async list(orgId: string, campaignId?: string): Promise<ContractDto[]> {
    const where = campaignId
      ? and(
          tenantScope(orgId, schema.contracts),
          eq(schema.contracts.campaignId, campaignId),
        )
      : tenantScope(orgId, schema.contracts);

    const rows = await this.db
      .select()
      .from(schema.contracts)
      .where(where)
      .orderBy(desc(schema.contracts.createdAt));

    return rows.map(toDto);
  }

  // Insert a contract for the org. All deal fields are optional (a blank "+ New"
  // row is valid); status falls back to the column default (GENERATED).
  async create(orgId: string, body: CreateContractDto): Promise<ContractDto> {
    const inserted = await this.db
      .insert(schema.contracts)
      .values({
        organizationId: orgId,
        leadId: body.leadId,
        customerId: body.customerId,
        campaignId: body.campaignId,
        templateAssetId: body.templateAssetId,
        signingMeetingId: body.signingMeetingId,
        driveFileId: body.driveFileId,
        driveUrl: body.driveUrl,
        cooperationTerm: body.cooperationTerm,
        company: body.company,
        sector: body.sector,
        value: body.value,
        deadline: body.deadline,
        contractType: body.contractType,
        analysis: body.analysis,
        ...(body.terms !== undefined ? { terms: body.terms } : {}),
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Failed to create contract');
    return toDto(row);
  }

  // Partial update of a contract in this org. Only provided keys are written; an
  // omitted key leaves its column unchanged. Nullable fields accept an explicit null
  // to clear them; `terms` replaces the whole array. 404 if the id is not this org's.
  async update(
    orgId: string,
    id: string,
    patch: UpdateContractDto,
  ): Promise<ContractDto> {
    const set: Partial<typeof schema.contracts.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if ('driveFileId' in patch) set.driveFileId = patch.driveFileId ?? null;
    if ('driveUrl' in patch) set.driveUrl = patch.driveUrl ?? null;
    if ('signedAt' in patch) {
      set.signedAt = patch.signedAt ? new Date(patch.signedAt) : null;
    }
    if ('error' in patch) set.error = patch.error ?? null;
    if ('cooperationTerm' in patch) {
      set.cooperationTerm = patch.cooperationTerm ?? null;
    }
    if ('company' in patch) set.company = patch.company ?? null;
    if ('sector' in patch) set.sector = patch.sector ?? null;
    if ('value' in patch) set.value = patch.value ?? null;
    if ('deadline' in patch) set.deadline = patch.deadline ?? null;
    if ('contractType' in patch) set.contractType = patch.contractType ?? null;
    if ('analysis' in patch) set.analysis = patch.analysis ?? null;
    if (patch.terms !== undefined) set.terms = patch.terms;

    const [row] = await this.db
      .update(schema.contracts)
      .set(set)
      .where(and(tenantScope(orgId, schema.contracts), eq(schema.contracts.id, id)))
      .returning();

    if (!row) {
      throw new NotFoundException(`Contract ${id} not found`);
    }

    return toDto(row);
  }

  // Delete a contract in this org. 404 if the id is not this org's.
  async remove(orgId: string, id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .delete(schema.contracts)
      .where(and(tenantScope(orgId, schema.contracts), eq(schema.contracts.id, id)))
      .returning({ id: schema.contracts.id });

    if (!row) {
      throw new NotFoundException(`Contract ${id} not found`);
    }

    return { id: row.id };
  }
}
