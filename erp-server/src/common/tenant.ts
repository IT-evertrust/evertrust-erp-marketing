import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { eq, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { isOwner, type UserRole } from '@evertrust/shared';
import type { AuthUser } from '../auth/auth.types';

// Tenant scoping primitives. Every org-scoped table carries an `organization_id`
// (see @evertrust/db); these helpers are how the API confines a query to the
// current tenant so future entity services cannot accidentally read across orgs.

// Minimal shape of an org-scoped Drizzle table: any table with an
// `organizationId` column. Kept structural so it works for users/tenders/
// suppliers/customers/auditLog/workflowExecutions/aiRuns without importing each.
export interface OrgScopedTable {
  organizationId: Parameters<typeof eq>[0];
}

// Build the Drizzle WHERE condition that confines `table` to one organization:
//   db.select().from(tenders).where(tenantScope(orgId, tenders))
// Combine with other predicates via Drizzle's `and(...)`.
export function tenantScope(orgId: string, table: OrgScopedTable): SQL {
  return eq(table.organizationId, orgId);
}

// Owner-aware variant — for the USERS ADMIN surface ONLY. The platform OWNER
// role reaches every org's users, so it returns `undefined` (no tenant
// confinement); every other role (and an absent role) is confined to its own
// org. `undefined` composes safely: callers use `cond ? q.where(cond) : q` for a
// bare list, or `cond ? and(cond, eq(id)) : eq(id)` for an id lookup — never
// `.where(undefined)`. This is the ONLY sanctioned cross-org seam, and ONLY for
// user administration; all other data stays tenant-scoped even for an Owner.
export function adminUserScope(
  actorRole: UserRole | undefined,
  orgId: string,
  table: OrgScopedTable,
): SQL | undefined {
  return actorRole && isOwner(actorRole) ? undefined : tenantScope(orgId, table);
}

// Param decorator that pulls the current tenant's organizationId off req.user
// (populated by JwtStrategy) straight into a handler argument:
//   list(@OrgId() orgId: string) { ... }
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return (req.user as AuthUser | undefined)?.organizationId;
  },
);
