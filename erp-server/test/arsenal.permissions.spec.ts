import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { ArsenalController } from '../src/arsenal/arsenal.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Arsenal triggers reuse the campaigns RBAC. NOTE: per-feature RBAC is
// INTENTIONALLY DISABLED for this deployment (commit c2a95a1 / ROLE_PERMISSIONS in
// @evertrust/shared) — every authenticated role holds the FULL permission set, so
// an EMPLOYEE may fire a stage and edit settings just like a MANAGER. Restoring the
// role matrix reverts this to a read-vs-write split.
const EMPLOYEE: AuthUser = { id: 'u-emp', role: 'EMPLOYEE', organizationId: 'org1' };
const MANAGER: AuthUser = { id: 'u-mgr', role: 'MANAGER', organizationId: 'org1' };

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

const ctxListRuns = (u: AuthUser) =>
  contextFor(
    () => ArsenalController.prototype.listRuns,
    () => ArsenalController,
    u,
  );
const ctxRun = (u: AuthUser) =>
  contextFor(
    () => ArsenalController.prototype.run,
    () => ArsenalController,
    u,
  );
const ctxGetSettings = (u: AuthUser) =>
  contextFor(
    () => ArsenalController.prototype.getSettings,
    () => ArsenalController,
    u,
  );
const ctxUpdateSettings = (u: AuthUser) =>
  contextFor(
    () => ArsenalController.prototype.updateSettings,
    () => ArsenalController,
    u,
  );

describe('arsenal route permission gating (RBAC disabled — flat access)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('every role now holds both campaigns:read and campaigns:write', () => {
    expect(hasPermission('EMPLOYEE', 'campaigns:read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'campaigns:write')).toBe(true);
    expect(hasPermission('MANAGER', 'campaigns:write')).toBe(true);
    expect(hasPermission('ADMIN', 'campaigns:write')).toBe(true);
  });

  it('allows EMPLOYEE to view runs', () => {
    expect(guard.canActivate(ctxListRuns(EMPLOYEE))).toBe(true);
  });

  it('allows EMPLOYEE to fire a stage (full access)', () => {
    expect(guard.canActivate(ctxRun(EMPLOYEE))).toBe(true);
  });

  it('allows MANAGER to fire a stage', () => {
    expect(guard.canActivate(ctxRun(MANAGER))).toBe(true);
  });

  it('lets both EMPLOYEE and MANAGER read and edit settings', () => {
    expect(guard.canActivate(ctxGetSettings(EMPLOYEE))).toBe(true);
    expect(guard.canActivate(ctxUpdateSettings(EMPLOYEE))).toBe(true);
    expect(guard.canActivate(ctxUpdateSettings(MANAGER))).toBe(true);
  });
});
