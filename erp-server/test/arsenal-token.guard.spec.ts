import { createHash } from 'node:crypto';
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ArsenalTokenGuard } from '../src/common/guards/arsenal-token.guard';
import type { AppConfigService } from '../src/config/app-config.service';
import type { WorkflowConfigService } from '../src/arsenal/workflow-config.service';

// The reusable machine-token guard. Its job: gate @Public() n8n routes on the shared
// ingest token. Resolution order: a ROTATED token (a stored SHA-256 hash in
// workflow_config) wins; otherwise fall back to the env ARSENAL_INGEST_TOKEN. 503
// when NEITHER is set, 401 on a missing/wrong token (constant-time compare), pass on
// an exact match.
const TOKEN = 'super-secret-ingest-token';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Build a guard with a given env token and a given stored ingest-token hash (null =
// no rotation, so the guard uses the env fallback).
function makeGuard(envToken: string, storedHash: string | null = null): ArsenalTokenGuard {
  const config = {
    get: (k: string) => (k === 'ARSENAL_INGEST_TOKEN' ? envToken : ''),
  } as unknown as AppConfigService;
  const workflowConfig = {
    getIngestTokenHash: async () => storedHash,
  } as unknown as WorkflowConfigService;
  return new ArsenalTokenGuard(config, workflowConfig);
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

describe('ArsenalTokenGuard — env-token fallback (no rotation)', () => {
  it('503s when neither a stored hash nor the env token is set', async () => {
    const guard = makeGuard('');
    await expect(guard.canActivate(ctxWith(TOKEN))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('401s when the header token is missing', async () => {
    const guard = makeGuard(TOKEN);
    await expect(guard.canActivate(ctxWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s when the header token is wrong', async () => {
    const guard = makeGuard(TOKEN);
    await expect(
      guard.canActivate(ctxWith('not-the-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s when the header token is the right value but a different length', async () => {
    const guard = makeGuard(TOKEN);
    await expect(guard.canActivate(ctxWith(TOKEN + 'x'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('passes (true) when the header token matches the env token exactly', async () => {
    const guard = makeGuard(TOKEN);
    await expect(guard.canActivate(ctxWith(TOKEN))).resolves.toBe(true);
  });
});

describe('ArsenalTokenGuard — rotated token (stored SHA-256 hash wins)', () => {
  it('passes when the header token hashes to the stored hash', async () => {
    // env token is DIFFERENT — proving the stored hash takes precedence.
    const guard = makeGuard('some-other-env-token', sha256(TOKEN));
    await expect(guard.canActivate(ctxWith(TOKEN))).resolves.toBe(true);
  });

  it('401s when the header token does not hash to the stored hash', async () => {
    const guard = makeGuard(TOKEN, sha256(TOKEN));
    await expect(guard.canActivate(ctxWith('wrong'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s (not 503) on a missing header even when only a hash is set', async () => {
    // No env token at all, but a rotated hash exists → a missing header is a 401,
    // never a 503 (the feature IS configured).
    const guard = makeGuard('', sha256(TOKEN));
    await expect(guard.canActivate(ctxWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
