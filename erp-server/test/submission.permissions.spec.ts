import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { SubmissionController } from '../src/submission/submission.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL submission routes' @RequirePermissions: reading readiness needs
// tenders:read, the submit act needs tenders:transition. Uses explicit per-user
// permission sets so the deny case is meaningful (every default role happens to hold
// tenders:transition; the guard honors user.permissions when present).
const READER: AuthUser = {
  id: 'u-reader',
  role: 'EMPLOYEE',
  organizationId: 'org1',
  permissions: ['tenders:read'],
};
const SUBMITTER: AuthUser = {
  id: 'u-submitter',
  role: 'EMPLOYEE',
  organizationId: 'org1',
  permissions: ['tenders:read', 'tenders:transition'],
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

const ctxReadiness = (u: AuthUser) =>
  contextFor(
    () => SubmissionController.prototype.readiness,
    () => SubmissionController,
    u,
  );
const ctxSubmit = (u: AuthUser) =>
  contextFor(
    () => SubmissionController.prototype.submit,
    () => SubmissionController,
    u,
  );

describe('Submission route permission gating', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('readiness needs only tenders:read (a reader can view the gate state)', () => {
    expect(guard.canActivate(ctxReadiness(READER))).toBe(true);
    expect(guard.canActivate(ctxReadiness(SUBMITTER))).toBe(true);
  });

  it('submit needs tenders:transition (a read-only user is forbidden)', () => {
    expect(() => guard.canActivate(ctxSubmit(READER))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctxSubmit(SUBMITTER))).toBe(true);
  });
});
