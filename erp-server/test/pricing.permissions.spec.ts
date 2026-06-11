import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@evertrust/shared';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { PricingController } from '../src/pricing/pricing.controller';
import { LineItemsController } from '../src/pricing/line-items.controller';
import type { AuthUser } from '../src/auth/auth.types';

// Binds the REAL pricing routes' declared @RequirePermissions to the
// SUPER_ADMIN–EMPLOYEE mapping end-to-end, so a regression in either the
// decorator or ROLE_PERMISSIONS is caught. EMPLOYEE holds pricing:read but NOT
// pricing:write/approve; MANAGER (and up) holds read + write + approve.
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

const ctxGetPricing = (u: AuthUser) =>
  contextFor(
    () => PricingController.prototype.getPricing,
    () => PricingController,
    u,
  );
const ctxUpsertPricing = (u: AuthUser) =>
  contextFor(
    () => PricingController.prototype.upsertPricing,
    () => PricingController,
    u,
  );
const ctxFinalize = (u: AuthUser) =>
  contextFor(
    () => PricingController.prototype.finalize,
    () => PricingController,
    u,
  );
const ctxCreateObservation = (u: AuthUser) =>
  contextFor(
    () => LineItemsController.prototype.createObservation,
    () => LineItemsController,
    u,
  );
const ctxPriceAssist = (u: AuthUser) =>
  contextFor(
    () => LineItemsController.prototype.priceAssist,
    () => LineItemsController,
    u,
  );

describe('pricing route permission gating (SUPER_ADMIN–EMPLOYEE matrix)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('the canonical pricing permission split holds', () => {
    expect(hasPermission('EMPLOYEE', 'pricing:read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'pricing:write')).toBe(false);
    expect(hasPermission('EMPLOYEE', 'pricing:approve')).toBe(false);
    expect(hasPermission('MANAGER', 'pricing:write')).toBe(true);
    expect(hasPermission('MANAGER', 'pricing:approve')).toBe(true);
  });

  it('allows EMPLOYEE to GET the pricing view (has pricing:read)', () => {
    expect(guard.canActivate(ctxGetPricing(EMPLOYEE))).toBe(true);
  });

  it('forbids EMPLOYEE from upserting pricing (lacks pricing:write)', () => {
    expect(() => guard.canActivate(ctxUpsertPricing(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });

  it('allows MANAGER to upsert pricing and record an observation (pricing:write)', () => {
    expect(guard.canActivate(ctxUpsertPricing(MANAGER))).toBe(true);
    expect(guard.canActivate(ctxCreateObservation(MANAGER))).toBe(true);
  });

  it('forbids EMPLOYEE from asking Claude for a price (price-assist needs pricing:write)', () => {
    expect(() => guard.canActivate(ctxPriceAssist(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });

  it('allows MANAGER to ask Claude for a price (pricing:write)', () => {
    expect(guard.canActivate(ctxPriceAssist(MANAGER))).toBe(true);
  });

  it('forbids EMPLOYEE from finalizing pricing (lacks pricing:approve)', () => {
    expect(() => guard.canActivate(ctxFinalize(EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });

  it('allows MANAGER to finalize pricing (has pricing:approve)', () => {
    expect(guard.canActivate(ctxFinalize(MANAGER))).toBe(true);
  });
});
