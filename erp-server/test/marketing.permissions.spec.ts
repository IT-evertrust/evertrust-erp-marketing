import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { MarketingController } from '../src/marketing/marketing.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL Marketing Draft-Review routes' @RequirePermissions to the role
// mapping end-to-end. NOTE: per-feature RBAC is INTENTIONALLY DISABLED for this
// deployment (commit c2a95a1 / ROLE_PERMISSIONS in @evertrust/shared) — every
// authenticated role holds the FULL permission set, so an EMPLOYEE may both view
// AND send drafts. Restoring the role matrix reverts this to a read-vs-send split.
const EMPLOYEE: AuthUser = { id: 'u-emp', role: 'EMPLOYEE', organizationId: 'o1' };
const MANAGER: AuthUser = { id: 'u-mgr', role: 'MANAGER', organizationId: 'o1' };

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
    () => MarketingController.prototype.listDrafts,
    () => MarketingController,
    u,
  );
const ctxSend = (u: AuthUser) =>
  contextFor(
    () => MarketingController.prototype.send,
    () => MarketingController,
    u,
  );

describe('Marketing Draft-Review permissions (RBAC disabled — flat access)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('EMPLOYEE can list drafts', () => {
    expect(guard.canActivate(ctxList(EMPLOYEE))).toBe(true);
  });

  it('EMPLOYEE can send a draft (full access)', () => {
    expect(guard.canActivate(ctxSend(EMPLOYEE))).toBe(true);
  });

  it('MANAGER can both list and send', () => {
    expect(guard.canActivate(ctxList(MANAGER))).toBe(true);
    expect(guard.canActivate(ctxSend(MANAGER))).toBe(true);
  });
});
