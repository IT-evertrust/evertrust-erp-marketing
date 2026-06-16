import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { AdminController } from '../src/users/admin.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL user-management routes' @RequirePermissions to the role matrix.
// Managing users — listing the directory + changing role/position/department — is
// users:manage, the single most privileged permission, held by SUPER_ADMIN ONLY.
// Even ADMIN (who holds every other permission) cannot manage users.
const SUPER_ADMIN: AuthUser = {
  id: 'u-sa',
  role: 'SUPER_ADMIN',
  organizationId: 'org1',
};
const ADMIN: AuthUser = { id: 'u-ad', role: 'ADMIN', organizationId: 'org1' };
const EMPLOYEE: AuthUser = {
  id: 'u-emp',
  role: 'EMPLOYEE',
  organizationId: 'org1',
};

function contextFor(
  getHandler: () => unknown,
  getClass: () => unknown,
  user: AuthUser,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler,
    getClass,
  } as unknown as ExecutionContext;
}

const ctxList = (u: AuthUser) =>
  contextFor(
    () => AdminController.prototype.listUsers,
    () => AdminController,
    u,
  );
const ctxUpdate = (u: AuthUser) =>
  contextFor(
    () => AdminController.prototype.updateUser,
    () => AdminController,
    u,
  );

describe('user-management route permission gating (users:manage)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('users:manage is held by SUPER_ADMIN only', () => {
    expect(hasPermission('SUPER_ADMIN', 'users:manage')).toBe(true);
    expect(hasPermission('ADMIN', 'users:manage')).toBe(false);
    expect(hasPermission('MANAGER', 'users:manage')).toBe(false);
    expect(hasPermission('EMPLOYEE', 'users:manage')).toBe(false);
  });

  it('allows SUPER_ADMIN to list and update users', () => {
    expect(guard.canActivate(ctxList(SUPER_ADMIN))).toBe(true);
    expect(guard.canActivate(ctxUpdate(SUPER_ADMIN))).toBe(true);
  });

  it('forbids ADMIN from listing or updating users (lacks users:manage)', () => {
    expect(() => guard.canActivate(ctxList(ADMIN))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctxUpdate(ADMIN))).toThrow(ForbiddenException);
  });

  it('forbids EMPLOYEE from updating users', () => {
    expect(() => guard.canActivate(ctxUpdate(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });
});

describe('PermissionsGuard honors per-user effective permissions', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('an explicit permission set grants access the role would not', () => {
    // EMPLOYEE role lacks users:manage, but an explicit per-user grant wins.
    const granted: AuthUser = {
      id: 'u-x',
      role: 'EMPLOYEE',
      organizationId: 'org1',
      permissions: ['campaigns:read', 'users:manage'],
    };
    expect(guard.canActivate(ctxUpdate(granted))).toBe(true);
  });

  it('an explicit permission set denies access the role would otherwise allow', () => {
    // The guard trusts the attached effective set: a narrow override loses even
    // for a SUPER_ADMIN role label.
    const stripped: AuthUser = {
      id: 'u-y',
      role: 'SUPER_ADMIN',
      organizationId: 'org1',
      permissions: ['campaigns:read'],
    };
    expect(() => guard.canActivate(ctxUpdate(stripped))).toThrow(
      ForbiddenException,
    );
  });

  it('falls back to role defaults when no explicit set is attached', () => {
    expect(guard.canActivate(ctxUpdate(SUPER_ADMIN))).toBe(true);
    expect(() => guard.canActivate(ctxUpdate(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });
});
