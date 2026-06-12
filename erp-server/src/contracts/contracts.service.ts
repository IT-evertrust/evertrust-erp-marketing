import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  ContractStatus,
  CreateContractDto,
  UpdateContractDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { writeMachineAudit } from '../common/machine-audit';

type ContractRow = typeof schema.contracts.$inferSelect;

// Filters for the contract read (ContractMaker's "already generated?" check).
export interface ContractListFilters {
  campaignId?: string;
  leadId?: string;
  status?: ContractStatus;
  limit?: number;
}

// Filters for the JWT org-scoped contract list (the UI). Same narrowing as the
// machine list but always confined to the caller's org.
export interface ContractOrgListFilters {
  campaignId?: string;
  leadId?: string;
  status?: ContractStatus;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

// ContractMaker output (the PDF stays in Drive). Created + status-flipped by the
// ContractMaker workflow. Machine routes — org resolved from the linked lead /
// customer / campaign; audited (actorType N8N).
@Injectable()
export class ContractsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async create(input: CreateContractDto): Promise<ContractRow> {
    const organizationId = await this.resolveOrg(input);
    const inserted = await this.db
      .insert(schema.contracts)
      .values({
        organizationId,
        leadId: input.leadId ?? null,
        customerId: input.customerId ?? null,
        campaignId: input.campaignId ?? null,
        templateAssetId: input.templateAssetId ?? null,
        signingMeetingId: input.signingMeetingId ?? null,
        driveFileId: input.driveFileId ?? null,
        driveUrl: input.driveUrl ?? null,
        cooperationTerm: input.cooperationTerm ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create contract');

    await writeMachineAudit(this.db, {
      organizationId,
      entity: 'contracts',
      entityId: row.id,
      action: 'CREATE',
      after: { status: row.status, campaignId: row.campaignId },
    });
    return row;
  }

  // Flip a contract's status / stamp signing (signing detection → SIGNED + signedAt).
  // 404 if the id is unknown. Audited.
  async update(id: string, patch: UpdateContractDto): Promise<ContractRow> {
    const rows = await this.db
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.id, id))
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundException('Contract not found');

    const set: Partial<typeof schema.contracts.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.driveFileId !== undefined) set.driveFileId = patch.driveFileId;
    if (patch.driveUrl !== undefined) set.driveUrl = patch.driveUrl;
    if (patch.signedAt !== undefined) {
      set.signedAt = patch.signedAt ? new Date(patch.signedAt) : null;
    }
    if (patch.error !== undefined) set.error = patch.error;

    const updated = await this.db
      .update(schema.contracts)
      .set(set)
      .where(eq(schema.contracts.id, id))
      .returning();
    const after = updated[0] ?? before;

    await writeMachineAudit(this.db, {
      organizationId: after.organizationId,
      entity: 'contracts',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
    return after;
  }

  // The contract list (newest-first) — ContractMaker checks campaignId/leadId/status
  // to avoid regenerating a contract it already produced. Defaults to 50 rows.
  async list(filters: ContractListFilters): Promise<ContractRow[]> {
    const conds = [];
    if (filters.campaignId) {
      conds.push(eq(schema.contracts.campaignId, filters.campaignId));
    }
    if (filters.leadId) {
      conds.push(eq(schema.contracts.leadId, filters.leadId));
    }
    if (filters.status) {
      conds.push(eq(schema.contracts.status, filters.status));
    }
    const base = this.db.select().from(schema.contracts);
    const scoped = conds.length ? base.where(and(...conds)) : base;
    const rows = await scoped.orderBy(desc(schema.contracts.createdAt));

    const limit =
      filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
    return rows.slice(0, limit);
  }

  // The JWT org-scoped contract list (the UI). ORG-SCOPED: every query confined to
  // orgId so a caller only ever sees its own org's contracts. Newest-first; the
  // optional campaignId/leadId/status narrow further. Defaults to 50 rows.
  async listForOrg(
    orgId: string,
    filters: ContractOrgListFilters,
  ): Promise<ContractRow[]> {
    const conds = [eq(schema.contracts.organizationId, orgId)];
    if (filters.campaignId) {
      conds.push(eq(schema.contracts.campaignId, filters.campaignId));
    }
    if (filters.leadId) {
      conds.push(eq(schema.contracts.leadId, filters.leadId));
    }
    if (filters.status) {
      conds.push(eq(schema.contracts.status, filters.status));
    }
    const rows = await this.db
      .select()
      .from(schema.contracts)
      .where(and(...conds))
      .orderBy(desc(schema.contracts.createdAt));

    const limit =
      filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
    return rows.slice(0, limit);
  }

  // Resolve the tenant from the linked lead / customer / campaign (first present).
  private async resolveOrg(input: CreateContractDto): Promise<string> {
    if (input.leadId) {
      const r = await this.db
        .select({ organizationId: schema.leads.organizationId })
        .from(schema.leads)
        .where(eq(schema.leads.id, input.leadId))
        .limit(1);
      if (!r[0]) throw new NotFoundException(`No lead for id ${input.leadId}`);
      return r[0].organizationId;
    }
    if (input.customerId) {
      const r = await this.db
        .select({ organizationId: schema.customers.organizationId })
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .limit(1);
      if (!r[0]) {
        throw new NotFoundException(`No customer for id ${input.customerId}`);
      }
      return r[0].organizationId;
    }
    if (input.campaignId) {
      const r = await this.db
        .select({ organizationId: schema.campaigns.organizationId })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, input.campaignId))
        .limit(1);
      if (!r[0]) {
        throw new NotFoundException(`No campaign for id ${input.campaignId}`);
      }
      return r[0].organizationId;
    }
    throw new BadRequestException(
      'A contract needs a leadId, customerId, or campaignId to resolve its org.',
    );
  }
}
