import {
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { effectivePermissions } from '@evertrust/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppConfigService } from '../../config/app-config.service';
import { DB, type DbClient } from '../../db/db.tokens';
import type { AuthUser } from '../auth.types';

// Registered globally in app.module.ts. Verifies the JWT (via the 'jwt' strategy)
// for every route EXCEPT those marked @Public(). On success req.user = AuthUser.
//
// DEMO / NO-LOGIN MODE: when AUTH_DISABLED=true the guard skips the JWT entirely
// and attaches a real super-admin user (resolved once from the DB) so token-less
// requests still pass authn AND the downstream PermissionsGuard, and queries scope
// to that user's real organizationId. ⚠️ This opens the whole API — gate it. See
// env.schema.ts (AUTH_DISABLED / AUTH_DISABLED_USER_EMAIL).
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private bypassUser: AuthUser | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: DbClient,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.config.get('AUTH_DISABLED')) {
      const req = context.switchToHttp().getRequest<Request>();
      (req as Request & { user: AuthUser }).user = await this.resolveBypassUser();
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }

  // The super-admin that AUTH_DISABLED runs as. Looked up once and cached on this
  // singleton guard (role/permission edits to that user need a restart to re-read,
  // which is fine for a demo bypass). Resolves AUTH_DISABLED_USER_EMAIL, or the
  // first active SUPER_ADMIN when the email is blank.
  private async resolveBypassUser(): Promise<AuthUser> {
    if (this.bypassUser) return this.bypassUser;

    const email = this.config.get('AUTH_DISABLED_USER_EMAIL').trim();
    const where = email
      ? and(eq(schema.users.email, email), eq(schema.users.active, true))
      : and(eq(schema.users.role, 'SUPER_ADMIN'), eq(schema.users.active, true));

    const rows = await this.db
      .select({
        id: schema.users.id,
        role: schema.users.role,
        permissions: schema.users.permissions,
        organizationId: schema.users.organizationId,
      })
      .from(schema.users)
      .where(where)
      .limit(1);

    const u = rows[0];
    if (!u) {
      throw new UnauthorizedException(
        email
          ? `AUTH_DISABLED is set but no active user matches AUTH_DISABLED_USER_EMAIL=${email}`
          : 'AUTH_DISABLED is set but no active SUPER_ADMIN exists to impersonate',
      );
    }

    this.bypassUser = {
      id: u.id,
      role: u.role,
      organizationId: u.organizationId,
      permissions: effectivePermissions(u.role, u.permissions),
    };
    return this.bypassUser;
  }
}
