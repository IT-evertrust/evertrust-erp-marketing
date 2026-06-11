import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { CampaignsController } from '../src/campaigns/campaigns.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL Growth-Engine routes' @RequirePermissions to the SUPER_ADMIN–EMPLOYEE mapping.
// Everyone operational can SEE campaigns (campaigns:read), but LAUNCHING one
// (campaigns:write — it fires real outbound outreach) is a lead-level action held
// by MANAGER and up (SUPER_ADMIN/ADMIN), not by EMPLOYEE.
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

describe('campaign route permission gating (SUPER_ADMIN–EMPLOYEE matrix)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('the canonical campaigns permission split holds', () => {
    expect(hasPermission('EMPLOYEE', 'campaigns:read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'campaigns:write')).toBe(false);
    expect(hasPermission('MANAGER', 'campaigns:write')).toBe(true);
    expect(hasPermission('ADMIN', 'campaigns:write')).toBe(true);
  });

  it('allows EMPLOYEE to list campaigns (has campaigns:read)', () => {
    expect(guard.canActivate(ctxList(EMPLOYEE))).toBe(true);
  });

  it('forbids EMPLOYEE from launching a campaign (lacks campaigns:write)', () => {
    expect(() => guard.canActivate(ctxCreate(EMPLOYEE))).toThrow(ForbiddenException);
  });

  it('allows MANAGER to launch a campaign (has campaigns:write)', () => {
    expect(guard.canActivate(ctxCreate(MANAGER))).toBe(true);
  });

  it('gates delete by campaigns:write (EMPLOYEE forbidden, MANAGER allowed)', () => {
    expect(() => guard.canActivate(ctxRemove(EMPLOYEE))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctxRemove(MANAGER))).toBe(true);
  });
});
