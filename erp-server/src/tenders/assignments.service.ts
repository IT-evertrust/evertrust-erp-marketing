import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { AssignmentDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

// Manual L5-PIC assignment (Phase 4 / R21). Assignments inherit tenancy from
// their parent tender; every operation re-verifies the tender (and the PIC) are
// in the caller's org before touching the assignments table.
@Injectable()
export class AssignmentsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // Confirm the tender exists in the caller's org (404 otherwise) and return it.
  private async tenderInOrg(orgId: string, tenderId: string) {
    const rows = await this.db
      .select({ id: schema.tenders.id })
      .from(schema.tenders)
      .where(
        and(
          tenantScope(orgId, schema.tenders),
          eq(schema.tenders.id, tenderId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Tender not found');
    return row;
  }

  // The ACTIVE assignment of a tender as a DTO, or null when unassigned. The PIC
  // name is resolved in a second lookup (kept join-free for testability). 404 if
  // the tender is missing/other-org.
  async getActive(orgId: string, tenderId: string): Promise<AssignmentDto | null> {
    await this.tenderInOrg(orgId, tenderId);

    const rows = await this.db
      .select({
        id: schema.assignments.id,
        tenderId: schema.assignments.tenderId,
        picId: schema.assignments.picId,
        reason: schema.assignments.reason,
        assignedAt: schema.assignments.assignedAt,
        status: schema.assignments.status,
      })
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.tenderId, tenderId),
          eq(schema.assignments.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return { ...row, picName: await this.picName(row.picId) } as unknown as AssignmentDto;
  }

  // Display name for a PIC user id (empty string if the user vanished).
  private async picName(picId: string): Promise<string> {
    const rows = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, picId))
      .limit(1);
    return rows[0]?.name ?? '';
  }

  // Assign a tender to a PIC. Supersedes any existing ACTIVE assignment for that
  // tender (-> REASSIGNED) and inserts a fresh ACTIVE one. 404 if the tender is
  // missing/other-org; 400 if picId is not a user in the same org.
  async assign(
    orgId: string,
    tenderId: string,
    picId: string,
    reason?: string,
  ): Promise<AssignmentDto> {
    await this.tenderInOrg(orgId, tenderId);

    // The PIC must be a real user in the SAME org — never assign across tenants.
    const picRows = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(and(tenantScope(orgId, schema.users), eq(schema.users.id, picId)))
      .limit(1);
    const pic = picRows[0];
    if (!pic) {
      throw new BadRequestException('picId is not a user in this organization');
    }

    // Supersede the current ACTIVE assignment (if any) so there is at most one.
    await this.db
      .update(schema.assignments)
      .set({ status: 'REASSIGNED' })
      .where(
        and(
          eq(schema.assignments.tenderId, tenderId),
          eq(schema.assignments.status, 'ACTIVE'),
        ),
      );

    const inserted = await this.db
      .insert(schema.assignments)
      .values({
        tenderId,
        picId,
        // Manual assignment carries no computed workload; record a neutral 0.
        workloadScore: '0',
        reason: reason ?? null,
        status: 'ACTIVE',
        assignedAt: new Date(),
      })
      .returning({
        id: schema.assignments.id,
        tenderId: schema.assignments.tenderId,
        picId: schema.assignments.picId,
        reason: schema.assignments.reason,
        assignedAt: schema.assignments.assignedAt,
        status: schema.assignments.status,
      });

    const row = inserted[0];
    if (!row) throw new Error('Failed to create assignment');
    return { ...row, picName: pic.name } as unknown as AssignmentDto;
  }
}
