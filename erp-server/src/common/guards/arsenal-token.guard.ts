import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';

// The single auth boundary for n8n→ERP MACHINE routes. They are @Public() (n8n has
// no JWT session); their ONLY gate is the shared ARSENAL_INGEST_TOKEN, sent in the
// `x-arsenal-token` header. Treat that token like a password.
//
//   503  the token is not configured (feature off by default — the route can't be
//        hit until an operator deliberately mints a secret)
//   401  the header token is missing or doesn't match (constant-time compare)
//
// Usage: @Public() @UseGuards(ArsenalTokenGuard) on the machine handler. Route-level
// guards run AFTER the global JwtAuthGuard/PermissionsGuard, which @Public() makes
// no-ops — so this guard is the effective authority on these routes.
@Injectable()
export class ArsenalTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const expected = this.config.get('ARSENAL_INGEST_TOKEN');
    if (!expected) {
      throw new ServiceUnavailableException(
        'Machine ingest is not configured (set ARSENAL_INGEST_TOKEN).',
      );
    }

    const provided = req.header('x-arsenal-token') ?? '';
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on unequal-length buffers.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid arsenal ingest token.');
    }
    return true;
  }
}
