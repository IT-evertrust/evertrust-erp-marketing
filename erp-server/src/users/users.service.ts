import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { schema } from '@evertrust/db';
import { effectivePermissions } from '@evertrust/shared';
import type {
  AdminUserDto,
  CreateUserDto,
  Department,
  MeDto,
  Permission,
  Position,
  UpdateUserDto,
  UserListItemDto,
  UserRole,
  UserStatsDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { adminUserScope, tenantScope } from '../common/tenant';

export interface UpdateNameResult {
  before: { name: string };
  after: MeDto;
}

export interface UpdateUserResult {
  before: {
    name: string;
    email: string;
    role: UserRole;
    position: Position | null;
    department: Department | null;
    active: boolean;
    permissions: Permission[] | null;
  };
  after: AdminUserDto;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // List the users in the caller's organization (id/name/email/role + dept/
  // position), ordered by name. Tenant-scoped — never returns users from another
  // org. Used by the assignee picker; no credential/auth fields are selected.
  async listForOrg(orgId: string): Promise<UserListItemDto[]> {
    return this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        department: schema.users.department,
        position: schema.users.position,
      })
      .from(schema.users)
      .where(tenantScope(orgId, schema.users))
      .orderBy(asc(schema.users.name));
  }

  // Update the user's display name and return both the prior name (for the audit
  // `before`) and the full updated user (for the response + audit `after`).
  async updateName(userId: string, name: string): Promise<UpdateNameResult> {
    const existing = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const prev = existing[0];
    if (!prev) throw new NotFoundException('User not found');

    const updated = await this.db
      .update(schema.users)
      .set({ name })
      .where(eq(schema.users.id, userId))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        organizationId: schema.users.organizationId,
      });

    const after = updated[0];
    if (!after) throw new NotFoundException('User not found');

    return { before: { name: prev.name }, after };
  }

  // Full user directory for the management table (users:manage). Tenant-scoped
  // for everyone EXCEPT the platform Owner, who sees every org's users (the only
  // cross-org seam — user administration only). Each row carries its org id +
  // name so the Owner's list can show which org a user belongs to. createdAt is
  // serialized to ISO so it matches the AdminUserDto wire shape.
  async listAllForOrg(
    orgId: string,
    actorRole?: UserRole,
  ): Promise<AdminUserDto[]> {
    const orgCond = adminUserScope(actorRole, orgId, schema.users);
    const base = this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        role: schema.users.role,
        position: schema.users.position,
        department: schema.users.department,
        permissions: schema.users.permissions,
        active: schema.users.active,
        createdAt: schema.users.createdAt,
        organizationId: schema.users.organizationId,
      })
      .from(schema.users);
    const rows = await (orgCond ? base.where(orgCond) : base).orderBy(
      asc(schema.users.name),
    );

    // Resolve org names in one extra query (no join — keeps the in-memory fake +
    // the read simple). A non-Owner sees only its own org; an Owner spans orgs.
    // Best-effort: a missing org degrades to null, never an error.
    const orgIds = [...new Set(rows.map((r) => r.organizationId))];
    const orgs = orgIds.length
      ? await this.db
          .select({
            id: schema.organizations.id,
            name: schema.organizations.name,
          })
          .from(schema.organizations)
          .where(inArray(schema.organizations.id, orgIds))
      : [];
    const nameById = new Map(orgs.map((o) => [o.id, o.name]));

    return rows.map((r) => ({
      ...r,
      permissions: r.permissions as Permission[] | null,
      createdAt: new Date(r.createdAt).toISOString(),
      organizationName: nameById.get(r.organizationId) ?? null,
    }));
  }

  // Update a user's role/position/department, or (de)activate them. Tenant-scoped
  // on BOTH the prior read (audit `before` + 404) and the write, so an admin can
  // never touch a user outside their org. Guarded: a Super Admin's role cannot be
  // changed, and you cannot deactivate yourself or a Super Admin. Only provided
  // fields change; position/department may be set to null to clear them.
  async updateUser(
    orgId: string,
    actingUserId: string,
    userId: string,
    dto: UpdateUserDto,
    actorRole?: UserRole,
  ): Promise<UpdateUserResult> {
    // Only an Owner may grant the Owner role (cross-org privilege-escalation
    // guard). Checked first so the error is role-shaped, not a 404.
    if (dto.role === 'OWNER' && actorRole !== 'OWNER') {
      throw new ForbiddenException('Only an Owner can grant the Owner role');
    }
    const orgCond = adminUserScope(actorRole, orgId, schema.users);
    const scope = orgCond
      ? and(orgCond, eq(schema.users.id, userId))
      : eq(schema.users.id, userId);

    const existing = await this.db
      .select({
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        role: schema.users.role,
        position: schema.users.position,
        department: schema.users.department,
        active: schema.users.active,
        permissions: schema.users.permissions,
      })
      .from(schema.users)
      .where(scope)
      .limit(1);

    const prev = existing[0];
    if (!prev) throw new NotFoundException('User not found');

    // The Owner is the top tier: only another Owner may modify an Owner (role,
    // status, permissions, identity). Mirrors the Super Admin protection below.
    if (prev.role === 'OWNER' && actorRole !== 'OWNER') {
      throw new ForbiddenException('Only an Owner can modify an Owner');
    }

    // Super Admin is protected: its role can't be changed (no demoting the top
    // admin / locking the org out).
    if (
      prev.role === 'SUPER_ADMIN' &&
      dto.role !== undefined &&
      dto.role !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException("A Super Admin's role cannot be changed");
    }

    // Deactivation guards: never your own account, never a Super Admin.
    if (dto.active === false) {
      if (userId === actingUserId) {
        throw new ForbiddenException('You cannot deactivate your own account');
      }
      if (prev.role === 'SUPER_ADMIN') {
        throw new ForbiddenException('A Super Admin cannot be deactivated');
      }
    }

    // Self-lockout guard: you can never end up without user-management access on
    // your OWN account (via a role change, a permission edit, or a reset).
    const nextRole = dto.role ?? prev.role;
    const nextStored =
      dto.permissions !== undefined ? dto.permissions : prev.permissions;
    if (
      userId === actingUserId &&
      !effectivePermissions(nextRole, nextStored).includes('users:manage')
    ) {
      throw new ForbiddenException(
        'You cannot remove your own user-management access',
      );
    }

    // Email change must stay globally unique (it's the login identity). The
    // Super-Admin-only restriction on email is enforced at the controller.
    if (dto.email !== undefined && dto.email !== prev.email) {
      const clash = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, dto.email))
        .limit(1);
      if (clash[0] && clash[0].id !== userId) {
        throw new ConflictException('That email is already in use');
      }
    }

    const patch: Partial<{
      name: string;
      email: string;
      phone: string | null;
      role: UserRole;
      position: Position | null;
      department: Department | null;
      active: boolean;
      permissions: Permission[] | null;
    }> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.department !== undefined) patch.department = dto.department;
    if (dto.active !== undefined) patch.active = dto.active;
    // SUPER_ADMIN is always full — its stored permissions are ignored (effective
    // is computed as all), so only persist permission edits for non-SA targets.
    if (dto.permissions !== undefined && nextRole !== 'SUPER_ADMIN') {
      patch.permissions = dto.permissions;
    }

    const selection = {
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      phone: schema.users.phone,
      role: schema.users.role,
      position: schema.users.position,
      department: schema.users.department,
      permissions: schema.users.permissions,
      active: schema.users.active,
      createdAt: schema.users.createdAt,
    };

    // Empty patch (no fields sent): return the current row unchanged.
    const rows =
      Object.keys(patch).length === 0
        ? await this.db.select(selection).from(schema.users).where(scope).limit(1)
        : await this.db
            .update(schema.users)
            .set(patch)
            .where(scope)
            .returning(selection);

    const after = rows[0];
    if (!after) throw new NotFoundException('User not found');

    return {
      before: { ...prev, permissions: prev.permissions as Permission[] | null },
      after: {
        ...after,
        permissions: after.permissions as Permission[] | null,
        createdAt: new Date(after.createdAt).toISOString(),
      },
    };
  }

  // Create a new user + their argon2 login credential, in one transaction. No
  // public register flow exists, so a users:manage admin sets the initial
  // password here. Email must be globally unique (409 on clash).
  async createUser(
    orgId: string,
    dto: CreateUserDto,
    actorRole?: UserRole,
  ): Promise<AdminUserDto> {
    // Granting the Owner role is Owner-only (privilege-escalation guard).
    if (dto.role === 'OWNER' && actorRole !== 'OWNER') {
      throw new ForbiddenException('Only an Owner can grant the Owner role');
    }
    const existing = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .limit(1);
    if (existing[0]) {
      throw new ConflictException('That email is already in use');
    }

    const passwordHash = await argon2.hash(dto.password);
    const selection = {
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      phone: schema.users.phone,
      role: schema.users.role,
      position: schema.users.position,
      department: schema.users.department,
      permissions: schema.users.permissions,
      active: schema.users.active,
      createdAt: schema.users.createdAt,
    };

    const created = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.users)
        .values({
          organizationId: orgId,
          name: dto.name,
          email: dto.email,
          phone: dto.phone ?? null,
          role: dto.role,
          position: dto.position ?? null,
          department: dto.department ?? null,
        })
        .returning(selection);
      const user = rows[0];
      if (!user) throw new Error('Failed to create user');
      await tx
        .insert(schema.authCredentials)
        .values({ userId: user.id, passwordHash });
      return user;
    });

    return {
      ...created,
      permissions: created.permissions as Permission[] | null,
      createdAt: new Date(created.createdAt).toISOString(),
    };
  }

  // Hard-delete a user + their credential (tenant-scoped, transactional). Guards:
  // never yourself, never a Super Admin. A user referenced by historical records
  // (audit actor, leads, pricing, …) can't be removed — we surface a 409 telling
  // the admin to deactivate instead, preserving the audit trail.
  async deleteUser(
    orgId: string,
    actingUserId: string,
    userId: string,
    actorRole?: UserRole,
  ): Promise<{ name: string; email: string }> {
    const orgCond = adminUserScope(actorRole, orgId, schema.users);
    const scope = orgCond
      ? and(orgCond, eq(schema.users.id, userId))
      : eq(schema.users.id, userId);
    const rows = await this.db
      .select({
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(scope)
      .limit(1);
    const prev = rows[0];
    if (!prev) throw new NotFoundException('User not found');
    if (userId === actingUserId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    // Only an Owner can delete an Owner (top tier protects itself).
    if (prev.role === 'OWNER' && actorRole !== 'OWNER') {
      throw new ForbiddenException('Only an Owner can delete an Owner');
    }
    if (prev.role === 'SUPER_ADMIN') {
      throw new ForbiddenException('A Super Admin cannot be deleted');
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(schema.authCredentials)
          .where(eq(schema.authCredentials.userId, userId));
        await tx.delete(schema.users).where(scope);
      });
    } catch (err) {
      // 23503 = FK violation: the user is referenced by historical records.
      if ((err as { code?: string })?.code === '23503') {
        throw new ConflictException(
          'This user has linked activity and can’t be deleted. Deactivate them instead.',
        );
      }
      throw err;
    }

    return { name: prev.name, email: prev.email };
  }

  // Real per-user contribution stats for the profile page (no fabricated data):
  // campaigns this user deployed, arsenal stages they triggered, and their
  // audited actions + a recent-activity feed. Tenant-scoped; 404 if not in org.
  async getStats(
    orgId: string,
    userId: string,
    actorRole?: UserRole,
  ): Promise<UserStatsDto> {
    const orgCond = adminUserScope(actorRole, orgId, schema.users);
    const u = await this.db
      .select({
        id: schema.users.id,
        organizationId: schema.users.organizationId,
      })
      .from(schema.users)
      .where(
        orgCond
          ? and(orgCond, eq(schema.users.id, userId))
          : eq(schema.users.id, userId),
      )
      .limit(1);
    if (!u[0]) throw new NotFoundException('User not found');
    // Sub-stats are scoped to the TARGET user's org (matters when an Owner views
    // a user in another org; for a non-Owner this equals orgId).
    const targetOrg = u[0].organizationId as string;

    const campaigns = await this.db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          tenantScope(targetOrg, schema.campaigns),
          eq(schema.campaigns.activatedBy, userId),
        ),
      );

    const runs = await this.db
      .select({ id: schema.arsenalRuns.id })
      .from(schema.arsenalRuns)
      .where(eq(schema.arsenalRuns.triggeredBy, userId));

    const audits = await this.db
      .select({
        entity: schema.auditLog.entity,
        action: schema.auditLog.action,
        at: schema.auditLog.at,
      })
      .from(schema.auditLog)
      .where(
        and(
          tenantScope(targetOrg, schema.auditLog),
          eq(schema.auditLog.actorId, userId),
        ),
      )
      .orderBy(desc(schema.auditLog.at));

    return {
      campaignsLaunched: campaigns.length,
      stagesRun: runs.length,
      actionsLogged: audits.length,
      recentActivity: audits.slice(0, 8).map((a) => ({
        entity: a.entity,
        action: a.action,
        at: new Date(a.at).toISOString(),
      })),
    };
  }

  // Admin password reset — re-hash the credential for a user in this org (404 if
  // not found). Upserts the credential row. There's no public reset flow.
  async setPassword(
    orgId: string,
    actingUserRole: UserRole,
    userId: string,
    password: string,
  ): Promise<void> {
    const orgCond = adminUserScope(actingUserRole, orgId, schema.users);
    const u = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(
        orgCond
          ? and(orgCond, eq(schema.users.id, userId))
          : eq(schema.users.id, userId),
      )
      .limit(1);
    const target = u[0];
    if (!target) throw new NotFoundException('User not found');
    // Only an Owner can reset an Owner's password.
    if (target.role === 'OWNER' && actingUserRole !== 'OWNER') {
      throw new ForbiddenException(
        "Only an Owner can reset an Owner's password",
      );
    }
    // A Super Admin's password is resettable only by a Super Admin or the Owner.
    if (
      target.role === 'SUPER_ADMIN' &&
      actingUserRole !== 'SUPER_ADMIN' &&
      actingUserRole !== 'OWNER'
    ) {
      throw new ForbiddenException(
        "Only a Super Admin can reset a Super Admin's password",
      );
    }

    const passwordHash = await argon2.hash(password);
    const updated = await this.db
      .update(schema.authCredentials)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(schema.authCredentials.userId, userId))
      .returning({ userId: schema.authCredentials.userId });
    if (updated.length === 0) {
      await this.db
        .insert(schema.authCredentials)
        .values({ userId, passwordHash });
    }
  }
}
