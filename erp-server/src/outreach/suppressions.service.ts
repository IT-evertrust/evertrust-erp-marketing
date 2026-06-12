import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { DB, type DbClient } from '../db/db.tokens';
import { writeMachineAudit } from '../common/machine-audit';

type SuppressionRow = typeof schema.suppressions.$inferSelect;

export interface SuppressionInput {
  email: string;
  reason?: string;
  sourceProspectId?: string;
  campaignId?: string;
}

// Org-wide do-not-contact list — Reach Bazooka's pre-send gate. Upsert on (org,
// email): rows are never deleted (the evidence is kept). org is resolved from the
// source prospect, else from the campaign. Machine route; audited (actorType N8N).
@Injectable()
export class SuppressionsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async create(input: SuppressionInput): Promise<{ id: string; created: boolean }> {
    const organizationId = await this.resolveOrg(input);
    const email = input.email.toLowerCase();

    const existing = await this.db
      .select()
      .from(schema.suppressions)
      .where(
        and(
          eq(schema.suppressions.organizationId, organizationId),
          eq(schema.suppressions.email, email),
        ),
      )
      .limit(1);
    if (existing[0]) return { id: existing[0].id, created: false };

    const inserted = await this.db
      .insert(schema.suppressions)
      .values({
        organizationId,
        email,
        reason: input.reason ?? null,
        sourceProspectId: input.sourceProspectId ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create suppression');

    await writeMachineAudit(this.db, {
      organizationId,
      entity: 'suppressions',
      entityId: row.id,
      action: 'CREATE',
      after: { email, reason: input.reason ?? null },
    });
    return { id: row.id, created: true };
  }

  // The JWT do-not-contact list for the UI — ORG-SCOPED, newest-first.
  async listForOrg(orgId: string): Promise<SuppressionRow[]> {
    return this.db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.organizationId, orgId))
      .orderBy(desc(schema.suppressions.createdAt));
  }

  // Un-suppress (the human override): hard-delete one suppression IN THE CALLER'S
  // ORG. ORG-SCOPED: 404 if the row is missing or belongs to another org. Returns
  // { deleted: true }. The JWT audit row is written by the global AuditInterceptor
  // (the controller sets the context).
  async deleteForOrg(orgId: string, id: string): Promise<{ deleted: boolean }> {
    const rows = await this.db
      .select()
      .from(schema.suppressions)
      .where(
        and(
          eq(schema.suppressions.organizationId, orgId),
          eq(schema.suppressions.id, id),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Suppression not found');

    await this.db
      .delete(schema.suppressions)
      .where(
        and(
          eq(schema.suppressions.organizationId, orgId),
          eq(schema.suppressions.id, id),
        ),
      );
    return { deleted: true };
  }

  // Resolve the tenant: prefer the source prospect's org, else the campaign's. The
  // DTO guarantees at least one is present; 404 if the referenced row is unknown.
  private async resolveOrg(input: SuppressionInput): Promise<string> {
    if (input.sourceProspectId) {
      const rows = await this.db
        .select({ organizationId: schema.prospects.organizationId })
        .from(schema.prospects)
        .where(eq(schema.prospects.id, input.sourceProspectId))
        .limit(1);
      if (!rows[0]) {
        throw new NotFoundException(
          `No prospect for sourceProspectId ${input.sourceProspectId}`,
        );
      }
      return rows[0].organizationId;
    }
    if (input.campaignId) {
      const rows = await this.db
        .select({ organizationId: schema.campaigns.organizationId })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, input.campaignId))
        .limit(1);
      if (!rows[0]) {
        throw new NotFoundException(`No campaign for campaignId ${input.campaignId}`);
      }
      return rows[0].organizationId;
    }
    // Unreachable — the DTO refine requires one of the two — but kept explicit.
    throw new NotFoundException('sourceProspectId or campaignId is required');
  }
}
