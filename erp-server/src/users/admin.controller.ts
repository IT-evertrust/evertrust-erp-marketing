import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AdminUserDto, UserStatsDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { UsersService } from './users.service';
import {
  CreateUserBodyDto,
  SetPasswordBodyDto,
  UpdateUserBodyDto,
} from './users.dto';

// Admin surface. RBAC is permission-based: the global PermissionsGuard 403s any
// principal whose role lacks the required permission. `admin:config` is held by
// Super Admin + Admin; `users:manage` (the user-management routes) by Super
// Admin only. Every route is tenant-scoped to the caller's organization.
@Controller('admin')
export class AdminController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions('admin:config')
  @Get('ping')
  ping(): { pong: true } {
    return { pong: true };
  }

  // User-management directory: full rows (incl. active + createdAt) for the
  // caller's org. Super Admin only (users:manage).
  @RequirePermissions('users:manage')
  @Get('users')
  listUsers(@OrgId() orgId: string): Promise<AdminUserDto[]> {
    return this.users.listAllForOrg(orgId);
  }

  // Change a user's role / position / department from the management table.
  // Super Admin only, tenant-scoped, and AUDITED (entity 'users', before/after
  // capture the changed fields) via the global AuditInterceptor.
  @RequirePermissions('users:manage')
  @Patch('users/:id')
  async updateUser(
    @OrgId() orgId: string,
    @CurrentUser() actingUser: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateUserBodyDto,
    @Req() req: Request,
  ): Promise<AdminUserDto> {
    // Email is the login identity — only a Super Admin may change it. Name and
    // the placement fields stay open to any users:manage holder.
    if (body.email !== undefined && actingUser.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only a Super Admin can change a user’s email',
      );
    }

    const { before, after } = await this.users.updateUser(
      orgId,
      actingUser.id,
      id,
      body,
    );

    setAuditContext(req, {
      entity: 'users',
      entityId: id,
      action: 'UPDATE',
      before,
      after: {
        name: after.name,
        email: after.email,
        phone: after.phone,
        role: after.role,
        position: after.position,
        department: after.department,
        active: after.active,
      },
    });

    return after;
  }

  // Create a new user (no public register flow). Any users:manage holder can add
  // a teammate; only a Super Admin may grant the SUPER_ADMIN role. AUDITED.
  @RequirePermissions('users:manage')
  @Post('users')
  async createUser(
    @OrgId() orgId: string,
    @CurrentUser() actingUser: AuthUser,
    @Body() body: CreateUserBodyDto,
    @Req() req: Request,
  ): Promise<AdminUserDto> {
    if (body.role === 'SUPER_ADMIN' && actingUser.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only a Super Admin can create a Super Admin',
      );
    }

    const created = await this.users.createUser(orgId, body);

    setAuditContext(req, {
      entity: 'users',
      entityId: created.id,
      action: 'CREATE',
      after: {
        name: created.name,
        email: created.email,
        phone: created.phone,
        role: created.role,
        position: created.position,
        department: created.department,
      },
    });

    return created;
  }

  // Real per-user contribution stats for the profile page (campaigns launched,
  // stages triggered, audited actions + recent activity). Tenant-scoped.
  @RequirePermissions('users:manage')
  @Get('users/:id/stats')
  getStats(
    @OrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<UserStatsDto> {
    return this.users.getStats(orgId, id);
  }

  // Admin password reset (no public reset flow). users:manage; only a Super
  // Admin may reset another Super Admin's password. AUDITED (no secrets stored).
  @RequirePermissions('users:manage')
  @Post('users/:id/password')
  async setPassword(
    @OrgId() orgId: string,
    @CurrentUser() actingUser: AuthUser,
    @Param('id') id: string,
    @Body() body: SetPasswordBodyDto,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    await this.users.setPassword(orgId, actingUser.role, id, body.password);
    setAuditContext(req, {
      entity: 'users',
      entityId: id,
      action: 'PASSWORD_RESET',
    });
    return { id };
  }

  // Hard-delete a user. Guarded in the service (never yourself / a Super Admin;
  // 409 if the user has linked records). AUDITED with the deleted identity.
  @RequirePermissions('users:manage')
  @Delete('users/:id')
  async deleteUser(
    @OrgId() orgId: string,
    @CurrentUser() actingUser: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const before = await this.users.deleteUser(orgId, actingUser.id, id);

    setAuditContext(req, {
      entity: 'users',
      entityId: id,
      action: 'DELETE',
      before,
    });

    return { id };
  }
}
