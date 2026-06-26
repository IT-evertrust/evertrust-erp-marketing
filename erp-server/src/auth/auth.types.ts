import type { Permission, UserRole } from '@evertrust/shared';

// The decoded JWT payload we sign on login and verify on every guarded request.
// org carries the tenant so request handling can scope to it WITHOUT a DB lookup.
export interface JwtPayload {
  sub: string; // user id (uuid)
  role: UserRole;
  org: string; // organization id (uuid) — the tenant boundary
  // Issued-at (seconds since epoch), stamped by jsonwebtoken on sign and present on
  // every decoded token. Compared against the user's token_invalid_before watermark
  // to enforce forced logout. We never set it ourselves; it's read-only here.
  iat?: number;
}

// What JwtStrategy.validate() returns and what gets attached to `req.user`.
// This is the authenticated principal used by guards, decorators, and audit.
// (`id` is kept as the existing field name; organizationId is the tenant.)
export interface AuthUser {
  id: string;
  role: UserRole;
  organizationId: string;
  // Effective permissions, resolved per request by JwtStrategy (per-user set or
  // role defaults). Optional so non-HTTP/test contexts can omit it — the guard
  // falls back to the role's permissions when absent.
  permissions?: Permission[];
}
