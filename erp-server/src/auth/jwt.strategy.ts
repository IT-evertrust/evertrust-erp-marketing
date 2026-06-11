import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { effectivePermissions } from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import { DB, type DbClient } from '../db/db.tokens';
import type { AuthUser, JwtPayload } from './auth.types';

// Pulls the JWT from the httpOnly `access_token` cookie first (browser flow),
// then falls back to the Authorization: Bearer header (API / n8n flow).
function fromCookieOrBearer(req: Request): string | null {
  const cookieToken = (
    req.cookies as Record<string, string> | undefined
  )?.access_token;
  if (cookieToken) return cookieToken;
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    @Inject(DB) private readonly db: DbClient,
  ) {
    super({
      jwtFromRequest: fromCookieOrBearer,
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  // Re-reads the user on EVERY request: role, permissions and active status are
  // authoritative in the DB (not the token), so permission/role edits and
  // deactivations take effect immediately rather than on next login. 401 if the
  // user vanished or was deactivated. Attaches the EFFECTIVE permission set so
  // the PermissionsGuard enforces per-user access.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const rows = await this.db
      .select({
        id: schema.users.id,
        role: schema.users.role,
        permissions: schema.users.permissions,
        active: schema.users.active,
        organizationId: schema.users.organizationId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub))
      .limit(1);

    const u = rows[0];
    if (!u || !u.active) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    return {
      id: u.id,
      role: u.role,
      organizationId: u.organizationId,
      permissions: effectivePermissions(u.role, u.permissions),
    };
  }
}
