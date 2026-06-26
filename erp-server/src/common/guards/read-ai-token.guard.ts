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

// Auth boundary for the Read AI → ERP webhook (a MACHINE route: Read AI posts the
// meeting report with no JWT session). It is @Public(); its ONLY gate is the shared
// secret READ_AI_WEBHOOK_SECRET. The secret may arrive either in the `x-read-ai-token`
// header (preferred) OR as a `?token=` query param — Read AI's webhook config only lets
// you set a URL on some plans, so the query fallback keeps it usable. Treat it like a
// password.
//
//   503  READ_AI_WEBHOOK_SECRET is unset (feature off by default — the route can't be
//        hit until an operator sets the secret)
//   401  the provided token is missing or doesn't match (constant-time compare)
//
// Usage: @Public() @UseGuards(ReadAiTokenGuard) on the webhook handler. Route-level
// guards run AFTER the global JwtAuthGuard/PermissionsGuard, which @Public() makes
// no-ops — so this guard is the effective authority on the route.
@Injectable()
export class ReadAiTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const headerToken = req.header('x-read-ai-token') ?? '';
    const queryToken =
      typeof req.query?.token === 'string' ? req.query.token : '';
    const provided = headerToken || queryToken;

    const expected = this.config.get('READ_AI_WEBHOOK_SECRET');
    if (!expected) {
      throw new ServiceUnavailableException(
        'Read AI webhook is not configured (set READ_AI_WEBHOOK_SECRET).',
      );
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on unequal-length buffers.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid Read AI webhook token.');
    }
    return true;
  }
}
