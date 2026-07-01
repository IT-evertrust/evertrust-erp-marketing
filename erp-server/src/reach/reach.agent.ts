import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { request } from 'undici';

import { AppConfigService } from '../config/app-config.service';

// Structured result returned by the erp-agents server (mirrors AgentResult).
export interface AgentRunResult {
  job_id: string;
  workflow: string;
  status: 'success' | 'failed' | 'partial';
  output: Record<string, unknown>;
  metrics: Record<string, unknown>;
  errors: string[];
}

// Synchronous client for the erp-agents service used by Reach (ammo_forge +
// lead_satellite). POSTs a job to `${AGENTS_BASE_URL}/run` and returns the
// AgentResult in the same request. Kept local to the reach module so Reach stays
// self-contained (mirrors EngageAgentClient).
@Injectable()
export class ReachAgentClient {
  private readonly logger = new Logger(ReachAgentClient.name);

  constructor(private readonly config: AppConfigService) {}

  isConfigured(): boolean {
    return this.config.get('AGENTS_BASE_URL').trim().length > 0;
  }

  async run(
    workflow: string,
    input: Record<string, unknown>,
    mode: 'dry_run' | 'live' = 'live',
    timeoutMs?: number,
  ): Promise<AgentRunResult> {
    const base = this.config.get('AGENTS_BASE_URL').trim().replace(/\/+$/, '');
    if (!base) {
      throw new ServiceUnavailableException(
        'Agent service is not configured (set AGENTS_BASE_URL).',
      );
    }

    // Per-call cap (the background Reach scrape passes a long one); falls back to the
    // global AGENT_TIMEOUT_MS for the quick foreground calls. We use undici.request
    // (NOT global fetch) and set headersTimeout/bodyTimeout to this cap: a Reach scrape
    // is a SINGLE long synchronous request — the agent sends no response headers until
    // the whole run finishes — and Node's global fetch hard-caps that at a 300s
    // headersTimeout, aborting any >5min scrape as "fetch failed" no matter what
    // AbortController we set. undici.request lets the cap be the real limit.
    const cap = timeoutMs ?? this.config.get('AGENT_TIMEOUT_MS');

    // The agent sits behind a Tailscale Funnel that can flap (the mini sleeps / the
    // relay drops), so a fresh connection occasionally dies "before the TLS handshake".
    // Retry that — but ONLY when it fails fast (connection setup), never a drop after the
    // long, side-effectful scrape has already started (elapsed >= RETRY_WINDOW_MS), to
    // avoid kicking off a second concurrent run.
    const MAX_ATTEMPTS = 3;
    const RETRY_WINDOW_MS = 30_000;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        const { statusCode, body } = await request(`${base}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow, mode, input }),
          headersTimeout: cap,
          bodyTimeout: cap,
        });
        if (statusCode < 200 || statusCode >= 300) {
          const text = await body.text().catch(() => '');
          throw new ServiceUnavailableException(
            `Agent ${workflow} HTTP ${statusCode}: ${text.slice(0, 200)}`,
          );
        }
        const result = (await body.json()) as AgentRunResult;
        if (result.status === 'failed') {
          throw new ServiceUnavailableException(
            `Agent ${workflow} failed: ${result.errors?.[0] ?? 'unknown error'}`,
          );
        }
        return result;
      } catch (err) {
        if (err instanceof ServiceUnavailableException) throw err; // agent answered — don't retry
        lastErr = err;
        const elapsed = Date.now() - startedAt;
        const retryable =
          attempt < MAX_ATTEMPTS &&
          elapsed < RETRY_WINDOW_MS &&
          isTransientConnectError(err);
        if (!retryable) break;
        const backoffMs = 2000 * attempt; // 2s, 4s
        this.logger.warn(
          `Agent ${workflow} connect failed (attempt ${attempt}/${MAX_ATTEMPTS}, ${Math.round(elapsed / 1000)}s) — retrying in ${backoffMs}ms: ${err instanceof Error ? err.message : 'error'}`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    const msg = lastErr instanceof Error ? lastErr.message : 'agent call failed';
    this.logger.warn(`Agent ${workflow} call failed: ${msg}`);
    throw new ServiceUnavailableException(`Agent ${workflow} call failed: ${msg}`);
  }
}

// A funnel-flap connection-setup failure (safe to retry), vs an HTTP/app error.
function isTransientConnectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code ?? '';
  const msg = (err as Error).message ?? '';
  return (
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    /socket disconnected before secure TLS|other side closed|ECONNRESET|ECONNREFUSED/i.test(
      msg,
    )
  );
}
