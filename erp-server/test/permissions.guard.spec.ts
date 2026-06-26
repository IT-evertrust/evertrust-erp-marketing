import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS,
  type Permission,
  permissionsForRole,
} from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import type { AuthUser } from '../src/auth/auth.types';

// Build a minimal ExecutionContext whose request carries the given principal.
function contextWithUser(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

// A Reflector stub that returns a fixed @RequirePermissions(...) value.
function reflectorReturning(perms: Permission[] | undefined): Reflector {
  return {
    getAllAndOverride: () => perms,
  } as unknown as Reflector;
}

const SUPER_ADMIN: AuthUser = { id: 'u1', role: 'SUPER_ADMIN', organizationId: 'org1' };
const EMPLOYEE: AuthUser = { id: 'u2', role: 'EMPLOYEE', organizationId: 'org1' };

// A principal carrying an EXPLICIT (narrow) per-user permission set. The guard
// prefers user.permissions over the role table (permissions.guard.ts), so this
// still exercises the deny path even though per-feature RBAC is intentionally
// disabled at the role-table level (commit c2a95a1).
const NARROW: AuthUser = {
  id: 'u3',
  role: 'EMPLOYEE',
  organizationId: 'org1',
  permissions: ['campaigns:read'],
};

// WHY: the guard is the single authorization control. Per-feature RBAC is
// intentionally flattened (every role holds every permission — see
// ROLE_PERMISSIONS in @evertrust/shared), so role-table denials no longer apply;
// these assert that flat reality AND keep the guard's MECHANISM covered — it must
// still honor an explicit per-user set and the AND-semantics, and still deny an
// unauthenticated request — so the scaffolding works the moment RBAC is restored.
describe('PermissionsGuard', () => {
  it('allows when the granted set holds the required permission (SUPER_ADMIN -> admin:config)', () => {
    const guard = new PermissionsGuard(reflectorReturning(['admin:config']));
    expect(guard.canActivate(contextWithUser(SUPER_ADMIN))).toBe(true);
  });

  it('allows EMPLOYEE through admin:config now that RBAC is flat (role grants every permission)', () => {
    const guard = new PermissionsGuard(reflectorReturning(['admin:config']));
    expect(guard.canActivate(contextWithUser(EMPLOYEE))).toBe(true);
  });

  it('still denies when the granted set lacks the required permission (explicit narrow override)', () => {
    const guard = new PermissionsGuard(reflectorReturning(['admin:config']));
    expect(() => guard.canActivate(contextWithUser(NARROW))).toThrow(
      ForbiddenException,
    );
  });

  it('requires ALL listed permissions (explicit set has campaigns:read but not performance:read)', () => {
    const guard = new PermissionsGuard(
      reflectorReturning(['campaigns:read', 'performance:read']),
    );
    expect(() => guard.canActivate(contextWithUser(NARROW))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when there is no authenticated principal', () => {
    const guard = new PermissionsGuard(reflectorReturning(['admin:config']));
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('allows any authenticated user when no @RequirePermissions is declared', () => {
    const guard = new PermissionsGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextWithUser(EMPLOYEE))).toBe(true);
  });
});

// WHY: ROLE_PERMISSIONS is the source of truth the guard expands. SUPER_ADMIN must be
// a superuser — if any permission is ever added but not granted to SUPER_ADMIN, that
// is a misconfiguration this test catches.
describe('permissionsForRole', () => {
  it('grants SUPER_ADMIN every defined permission', () => {
    const l1Perms = permissionsForRole('SUPER_ADMIN');
    for (const perm of PERMISSIONS) {
      expect(l1Perms).toContain(perm);
    }
    expect(l1Perms).toHaveLength(PERMISSIONS.length);
  });

  it('returns a fresh copy callers cannot mutate', () => {
    const a = permissionsForRole('EMPLOYEE');
    const len = a.length;
    a.push('admin:config'); // mutating the returned array must not grow the source
    expect(permissionsForRole('EMPLOYEE')).toHaveLength(len);
  });
});
