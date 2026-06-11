import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { ApprovalsController } from '../src/approvals/approvals.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL Phase 6 approval routes' declared @RequirePermissions to the
// SUPER_ADMIN–EMPLOYEE mapping end-to-end, so a regression in either the decorator or
// ROLE_PERMISSIONS is caught. The canonical split: everyone can READ approvals and
// any tender-writer (EMPLOYEE and up) can OPEN a request, but the DECISION — the
// act that unblocks submission — is approvals:decide, held by MANAGER and up.
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
    () => ApprovalsController.prototype.list,
    () => ApprovalsController,
    u,
  );
const ctxRequest = (u: AuthUser) =>
  contextFor(
    () => ApprovalsController.prototype.request,
    () => ApprovalsController,
    u,
  );
const ctxDecide = (u: AuthUser) =>
  contextFor(
    () => ApprovalsController.prototype.decide,
    () => ApprovalsController,
    u,
  );

describe('approval route permission gating (SUPER_ADMIN–EMPLOYEE matrix)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('the canonical approval permission split holds', () => {
    expect(hasPermission('EMPLOYEE', 'approvals:read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'approvals:decide')).toBe(false);
    expect(hasPermission('MANAGER', 'approvals:decide')).toBe(true);
    expect(hasPermission('ADMIN', 'approvals:decide')).toBe(true);
    // Opening a request rides on tenders:write — held by every tender-writer.
    expect(hasPermission('EMPLOYEE', 'tenders:write')).toBe(true);
  });

  it('allows EMPLOYEE to list approvals (has approvals:read)', () => {
    expect(guard.canActivate(ctxList(EMPLOYEE))).toBe(true);
  });

  it('allows EMPLOYEE to open a request (has tenders:write)', () => {
    expect(guard.canActivate(ctxRequest(EMPLOYEE))).toBe(true);
  });

  it('forbids EMPLOYEE from deciding (lacks approvals:decide)', () => {
    expect(() => guard.canActivate(ctxDecide(EMPLOYEE))).toThrow(ForbiddenException);
  });

  it('allows MANAGER to decide an approval (has approvals:decide)', () => {
    expect(guard.canActivate(ctxDecide(MANAGER))).toBe(true);
  });
});
