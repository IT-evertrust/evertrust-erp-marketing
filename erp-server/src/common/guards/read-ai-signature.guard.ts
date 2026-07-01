import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';

// Auth boundary for the Read AI → ERP webhook (a MACHINE route: Read AI posts the
// meeting report with no JWT session). It is @Public(); its ONLY gate is the HMAC
// signature Read AI computes over the raw request body with the webhook's signing
// key, sent in the `X-Read-Signature` header.
//
// Verification (per Read AI's webhook docs):
//   1. base64-decode READ_AI_WEBHOOK_SIGNING_KEY → the HMAC key bytes
//   2. digest = HMAC-SHA256(keyBytes, RAW request body).hex()   (lowercase hex)
//   3. constant-time compare digest against the `X-Read-Signature` header value
//
// The RAW body is required — a parsed-then-reserialized JSON object would not byte-
// match what Read AI signed. main.ts boots with `rawBody: true` so `req.rawBody`
// holds the original buffer.
//
//   503  READ_AI_WEBHOOK_SIGNING_KEY is unset (feature off by default — the route
//        can't be hit until an operator mints the key in Read AI + sets it here)
//   401  the X-Read-Signature header is missing, or the computed digest doesn't
//        match (raw body unavailable is treated as a verification failure)
//
// Usage: @Public() @UseGuards(ReadAiSignatureGuard) on the webhook handler. Route-
// level guards run AFTER the global JwtAuthGuard/PermissionsGuard, which @Public()
// makes no-ops — so this guard is the effective authority on the route.
@Injectable()
export class ReadAiSignatureGuard implements CanActivate {
  private readonly logger = new Logger(ReadAiSignatureGuard.name);

  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const signingKey = this.config.get('READ_AI_WEBHOOK_SIGNING_KEY');
    if (!signingKey) {
      throw new ServiceUnavailableException(
        'Read AI webhook is not configured (set READ_AI_WEBHOOK_SIGNING_KEY).',
      );
    }

    const provided = req.header('x-read-ai-signature') ?? '';
    if (!provided) {
      throw new UnauthorizedException('Missing X-Read-Signature header.');
    }

    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      // No raw body to verify against — reject rather than trust an unsigned payload.
      this.logger.warn('Read AI webhook: raw body unavailable; rejecting.');
      throw new UnauthorizedException('Could not verify Read AI signature.');
    }

    const keyBytes = Buffer.from(signingKey, 'base64');
    const expected = createHmac('sha256', keyBytes).update(raw).digest('hex');

    const a = Buffer.from(provided.toLowerCase());
    const b = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on unequal-length buffers.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid Read AI signature.');
    }
    return true;
  }
}
