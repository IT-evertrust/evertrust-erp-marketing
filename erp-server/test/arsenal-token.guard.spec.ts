import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ArsenalTokenGuard } from '../src/common/guards/arsenal-token.guard';
import type { AppConfigService } from '../src/config/app-config.service';

// The reusable machine-token guard. Its ONLY job: gate @Public() n8n routes on the
// shared ARSENAL_INGEST_TOKEN. 503 when unset (feature off by default), 401 on a
// missing/wrong token (constant-time compare), pass on an exact match.
const TOKEN = 'super-secret-ingest-token';

function makeGuard(token: string): ArsenalTokenGuard {
  const config = {
    get: (k: string) => (k === 'ARSENAL_INGEST_TOKEN' ? token : ''),
  } as unknown as AppConfigService;
  return new ArsenalTokenGuard(config);
}

function ctxWith(headerToken?: string): ExecutionContext {
  const req = {
    header: (name: string) =>
      name.toLowerCase() === 'x-arsenal-token' ? headerToken : undefined,
  } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ArsenalTokenGuard', () => {
  it('503s when no ingest token is configured (feature off by default)', () => {
    const guard = makeGuard('');
    expect(() => guard.canActivate(ctxWith(TOKEN))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('401s when the header token is missing', () => {
    const guard = makeGuard(TOKEN);
    expect(() => guard.canActivate(ctxWith())).toThrow(UnauthorizedException);
  });

  it('401s when the header token is wrong', () => {
    const guard = makeGuard(TOKEN);
    expect(() => guard.canActivate(ctxWith('not-the-token'))).toThrow(
      UnauthorizedException,
    );
  });

  it('401s when the header token is the right value but a different length', () => {
    const guard = makeGuard(TOKEN);
    expect(() => guard.canActivate(ctxWith(TOKEN + 'x'))).toThrow(
      UnauthorizedException,
    );
  });

  it('passes (true) when the header token matches exactly', () => {
    const guard = makeGuard(TOKEN);
    expect(guard.canActivate(ctxWith(TOKEN))).toBe(true);
  });
});
