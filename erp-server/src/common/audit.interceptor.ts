import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { schema } from '@evertrust/db';
import { DB, type DbClient } from '../db/db.tokens';
import type { AuthUser } from '../auth/auth.types';
import { getAuditContext } from './audit-context';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Global interceptor implementing the doctrine path: Workflow/Client -> API ->
// DB -> AUDIT. For every SUCCESSFUL mutating request it writes one audit_log row
// (actorType USER, actorId from JWT, correlationId = requestId). The handler can
// enrich the row via setAuditContext() (entity/entityId/before/after).
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING_METHODS.has(req.method)) return next.handle();

    // Only persist on success; errors must NOT produce a misleading audit row.
    return next.handle().pipe(
      tap({
        next: () => void this.write(req),
      }),
    );
  }

  private async write(req: Request): Promise<void> {
    const ctx = getAuditContext(req);
    const user = req.user as AuthUser | undefined;

    const entity = ctx?.entity ?? req.path;
    const action = ctx?.action ?? req.method;
    const entityId = ctx?.entityId ?? null;
    const correlationId =
      (req as Request & { id?: string }).id ??
      (req.headers['x-request-id'] as string | undefined) ??
      null;

    // audit_log.entity_id is `uuid NOT NULL`. When a mutation has no real entity
    // uuid (e.g. a generic POST), we cannot satisfy the column — so we SKIP the
    // insert and log it loudly rather than crash the request or silent-drop.
    if (!entityId || !UUID_RE.test(entityId)) {
      this.logger.debug(
        { entity, action, correlationId, actorId: user?.id ?? null },
        'audit skipped: no uuid entityId for mutating request',
      );
      return;
    }

    // audit_log.organization_id is also `uuid NOT NULL` — it is the tenant the
    // mutation happened in, taken from the authenticated principal. A mutating
    // request with no org principal (should not happen behind JwtAuthGuard) can't
    // satisfy the column, so SKIP + log loudly rather than crash with a DB error.
    if (!user?.organizationId) {
      this.logger.debug(
        { entity, action, correlationId, actorId: user?.id ?? null },
        'audit skipped: no organizationId on principal for mutating request',
      );
      return;
    }

    try {
      await this.db.insert(schema.auditLog).values({
        organizationId: user.organizationId,
        entity,
        entityId,
        action,
        actorType: 'USER',
        actorId: user.id,
        before: (ctx?.before ?? null) as never,
        after: (ctx?.after ?? null) as never,
        correlationId,
      });
    } catch (err) {
      // Audit failures are operational signal — never swallowed silently.
      this.logger.error(
        { err, entity, entityId, action, correlationId },
        'failed to write audit_log row',
      );
    }
  }
}
