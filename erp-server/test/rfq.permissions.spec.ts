import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { RfqController } from '../src/rfq/rfq.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL RFQ routes' @RequirePermissions to the role→permission matrix:
// listing RFQs is pricing:read (EMPLOYEE+), sending one is pricing:write (MANAGER+),
// since an RFQ gathers price evidence (same gate as recording an observation).
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
  contextFor(() => RfqController.prototype.list, () => RfqController, u);
const ctxCreate = (u: AuthUser) =>
  contextFor(() => RfqController.prototype.create, () => RfqController, u);

describe('RFQ route permission gating', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows EMPLOYEE to list RFQs (pricing:read) but not send one (pricing:write)', () => {
    expect(hasPermission('EMPLOYEE', 'pricing:read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'pricing:write')).toBe(false);
    expect(guard.canActivate(ctxList(EMPLOYEE))).toBe(true);
    expect(() => guard.canActivate(ctxCreate(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });

  it('allows MANAGER to both list and send RFQs', () => {
    expect(guard.canActivate(ctxList(MANAGER))).toBe(true);
    expect(guard.canActivate(ctxCreate(MANAGER))).toBe(true);
  });
});
