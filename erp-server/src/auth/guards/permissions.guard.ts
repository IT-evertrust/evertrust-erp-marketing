import { CanActivate, Injectable } from '@nestjs/common';

// AUTHORIZATION DISABLED (single-team internal app).
//
// This is the marketing department's own ERP for ~4 trusted colleagues — there is
// no need to restrict people from each other, so role/permission authorization is
// turned off. AUTHENTICATION is unchanged: JwtAuthGuard still requires a valid
// Google session on every non-@Public route, so we always know WHO the caller is
// (org + identity for per-user Gmail/Calendar). This guard used to expand the
// caller's role via ROLE_PERMISSIONS and 403 on any missing @RequirePermissions —
// now every authenticated request is allowed. The @RequirePermissions(...)
// decorators are left in place but are no-ops; restore the RBAC body here to
// re-enable them.
@Injectable()
export class PermissionsGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
