import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { MarketingController } from '../src/marketing/marketing.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL Marketing Draft-Review routes' @RequirePermissions to the role
// mapping end-to-end. The split: anyone who can READ campaigns can view the RAG
// drafts; SENDING a reply (real client email) is campaigns:write — MANAGER and up.
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

describe('Marketing Draft-Review permissions', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('EMPLOYEE can list drafts (campaigns:read)', () => {
    expect(guard.canActivate(ctxList(EMPLOYEE))).toBe(true);
  });

  it('EMPLOYEE cannot send a draft (campaigns:write)', () => {
    expect(() => guard.canActivate(ctxSend(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });

  it('MANAGER can both list and send', () => {
    expect(guard.canActivate(ctxList(MANAGER))).toBe(true);
    expect(guard.canActivate(ctxSend(MANAGER))).toBe(true);
  });
});
