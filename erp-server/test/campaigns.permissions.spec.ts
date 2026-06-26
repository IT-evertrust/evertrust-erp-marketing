import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { CampaignsController } from '../src/campaigns/campaigns.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL Growth-Engine routes' @RequirePermissions to the role mapping.
// NOTE: per-feature RBAC is INTENTIONALLY DISABLED for this deployment (see commit
// c2a95a1 / ROLE_PERMISSIONS in @evertrust/shared) — every authenticated role now
// holds the FULL permission set, so an EMPLOYEE may launch and delete campaigns
// just like a MANAGER. These assert that flat-access reality; restoring the role
// matrix in @evertrust/shared reverts them to a read-vs-write split.
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

const ctxList = (u: AuthUser) =>
  contextFor(
    () => CampaignsController.prototype.list,
    () => CampaignsController,
    u,
  );
const ctxCreate = (u: AuthUser) =>
  contextFor(
    () => CampaignsController.prototype.create,
    () => CampaignsController,
    u,
  );
const ctxRemove = (u: AuthUser) =>
  contextFor(
    () => CampaignsController.prototype.remove,
    () => CampaignsController,
    u,
  );

describe('campaign route permission gating (RBAC disabled — flat access)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('every role now holds both campaigns:read and campaigns:write', () => {
    expect(hasPermission('EMPLOYEE', 'campaigns:read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'campaigns:write')).toBe(true);
    expect(hasPermission('MANAGER', 'campaigns:write')).toBe(true);
    expect(hasPermission('ADMIN', 'campaigns:write')).toBe(true);
  });

  it('allows EMPLOYEE to list campaigns', () => {
    expect(guard.canActivate(ctxList(EMPLOYEE))).toBe(true);
  });

  it('allows EMPLOYEE to launch a campaign (full access)', () => {
    expect(guard.canActivate(ctxCreate(EMPLOYEE))).toBe(true);
  });

  it('allows MANAGER to launch a campaign', () => {
    expect(guard.canActivate(ctxCreate(MANAGER))).toBe(true);
  });

  it('allows both EMPLOYEE and MANAGER to delete a campaign', () => {
    expect(guard.canActivate(ctxRemove(EMPLOYEE))).toBe(true);
    expect(guard.canActivate(ctxRemove(MANAGER))).toBe(true);
  });
});
