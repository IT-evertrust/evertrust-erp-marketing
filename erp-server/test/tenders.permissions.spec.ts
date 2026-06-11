import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { TendersController } from '../src/tenders/tenders.controller';
import { CustomersController } from '../src/customers/customers.controller';
import type { AuthUser } from '../src/auth/auth.types';

// EMPLOYEE (Member / PIC) holds tenders:write but NOT customers:write. MANAGER (Lane lead)
// holds both. This split lets us bind a real route's declared permission to the
// SUPER_ADMIN–EMPLOYEE mapping end-to-end.
const EMPLOYEE: AuthUser = { id: 'u-l5', role: 'EMPLOYEE', organizationId: 'org1' };
const MANAGER: AuthUser = { id: 'u-l3', role: 'MANAGER', organizationId: 'org1' };

// Build an ExecutionContext that targets a REAL controller handler, so the guard
// reads the actual @RequirePermissions(...) metadata on the route (not a
// hand-fed value).
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

function contextForTenderCreate(user: AuthUser): ExecutionContext {
  return contextFor(
    () => TendersController.prototype.create,
    () => TendersController,
    user,
  );
}

function contextForCustomerCreate(user: AuthUser): ExecutionContext {
  return contextFor(
    () => CustomersController.prototype.create,
    () => CustomersController,
    user,
  );
}

function contextForTenderAssign(user: AuthUser): ExecutionContext {
  return contextFor(
    () => TendersController.prototype.assign,
    () => TendersController,
    user,
  );
}

// WHY: POST /tenders is gated by tenders:write — every L-role holds it. POST
// /customers is gated by customers:write — EMPLOYEE lacks it, MANAGER holds it. This binds
// the routes' declared permissions to the role mapping end-to-end, so a
// regression in either the decorator or ROLE_PERMISSIONS is caught.
describe('tender + customer write permission gating', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('EMPLOYEE holds tenders:write; EMPLOYEE lacks customers:write (MANAGER holds it)', () => {
    expect(hasPermission('EMPLOYEE', 'tenders:write')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'customers:write')).toBe(false);
    expect(hasPermission('MANAGER', 'customers:write')).toBe(true);
  });

  it('allows an EMPLOYEE to create a tender (has tenders:write)', () => {
    expect(guard.canActivate(contextForTenderCreate(EMPLOYEE))).toBe(true);
  });

  it('forbids an EMPLOYEE from creating a customer (lacks customers:write)', () => {
    expect(() => guard.canActivate(contextForCustomerCreate(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });

  it('allows an MANAGER to create a customer (has customers:write)', () => {
    expect(guard.canActivate(contextForCustomerCreate(MANAGER))).toBe(true);
  });

  // WHY: assignment is a MANAGER-and-up authority. EMPLOYEE (PIC)
  // can be assigned but cannot assign — POST /tenders/:id/assign is gated by
  // tenders:assign, which EMPLOYEE lacks. This pins the canonical permission split.
  it('MANAGER holds tenders:assign; EMPLOYEE does not', () => {
    expect(hasPermission('MANAGER', 'tenders:assign')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'tenders:assign')).toBe(false);
  });

  it('forbids an EMPLOYEE from assigning a tender (lacks tenders:assign)', () => {
    expect(() => guard.canActivate(contextForTenderAssign(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });

  it('allows an MANAGER to assign a tender (has tenders:assign)', () => {
    expect(guard.canActivate(contextForTenderAssign(MANAGER))).toBe(true);
  });
});
