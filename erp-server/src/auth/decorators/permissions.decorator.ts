import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@evertrust/shared';

// Declares the fine-grained permissions a route requires. PermissionsGuard reads
// this and allows the request only if the caller's role (expanded via
// ROLE_PERMISSIONS) holds ALL of them. e.g. @RequirePermissions('admin:config').
// No decorator on a route => authenticated-only (any logged-in user).
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
