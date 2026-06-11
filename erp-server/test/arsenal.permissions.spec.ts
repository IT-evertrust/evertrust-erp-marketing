import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { ArsenalController } from '../src/arsenal/arsenal.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Arsenal triggers reuse the campaigns RBAC: viewing runs is campaigns:read
// (everyone operational), firing a stage is campaigns:write (MANAGER and up) — it
// sends real outbound work, so EMPLOYEE can watch but not pull the trigger.
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

describe('arsenal route permission gating', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('reuses the campaigns split (read=all, write=MANAGER and up)', () => {
    expect(hasPermission('EMPLOYEE', 'campaigns:read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'campaigns:write')).toBe(false);
    expect(hasPermission('MANAGER', 'campaigns:write')).toBe(true);
    expect(hasPermission('ADMIN', 'campaigns:write')).toBe(true);
  });

  it('allows EMPLOYEE to view runs (campaigns:read)', () => {
    expect(guard.canActivate(ctxListRuns(EMPLOYEE))).toBe(true);
  });

  it('forbids EMPLOYEE from firing a stage (lacks campaigns:write)', () => {
    expect(() => guard.canActivate(ctxRun(EMPLOYEE))).toThrow(ForbiddenException);
  });

  it('allows MANAGER to fire a stage (campaigns:write)', () => {
    expect(guard.canActivate(ctxRun(MANAGER))).toBe(true);
  });

  it('lets EMPLOYEE read settings but not edit the daily time; MANAGER can edit', () => {
    expect(guard.canActivate(ctxGetSettings(EMPLOYEE))).toBe(true);
    expect(() => guard.canActivate(ctxUpdateSettings(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(ctxUpdateSettings(MANAGER))).toBe(true);
  });
});
