import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { WorkflowConfigService } from '../../arsenal/workflow-config.service';

// The single auth boundary for n8n→ERP MACHINE routes. They are @Public() (n8n has
// no JWT session); their ONLY gate is the shared ingest token, sent in the
// `x-arsenal-token` header. Treat that token like a password.
//
// Resolution (makes rotation-ready while behaving identically until a token is
// rotated): if workflow_config holds an ingest-token SHA-256 hash, the incoming
// header is hashed and constant-time-compared against it; otherwise we fall back to
// the env ARSENAL_INGEST_TOKEN constant-time compare.
//
//   503  neither a stored hash NOR the env token is set (feature off by default —
//        the route can't be hit until an operator mints/rotates a secret)
//   401  the header token is missing or doesn't match (constant-time compare)
//
// Usage: @Public() @UseGuards(ArsenalTokenGuard) on the machine handler. Route-level
// guards run AFTER the global JwtAuthGuard/PermissionsGuard, which @Public() makes
// no-ops — so this guard is the effective authority on these routes.
@Injectable()
export class ArsenalTokenGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly workflowConfig: WorkflowConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header('x-arsenal-token') ?? '';

    // Prefer a rotated token: compare SHA-256 hex digests (always equal length).
    const storedHash = await this.workflowConfig.getIngestTokenHash();
    if (storedHash) {
      const providedHash = createHash('sha256').update(provided).digest('hex');
      const a = Buffer.from(providedHash);
      const b = Buffer.from(storedHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new UnauthorizedException('Invalid arsenal ingest token.');
      }
      return true;
    }

    // Fallback: the env token (legacy behavior, unchanged until a token is rotated).
    const expected = this.config.get('ARSENAL_INGEST_TOKEN');
    if (!expected) {
      throw new ServiceUnavailableException(
        'Machine ingest is not configured (set ARSENAL_INGEST_TOKEN).',
      );
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on unequal-length buffers.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid arsenal ingest token.');
    }
    return true;
  }
}
