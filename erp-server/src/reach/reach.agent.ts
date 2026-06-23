import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

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

    const controller = new AbortController();
    // Per-call timeout override (the background Reach scrape passes a long one);
    // falls back to the global AGENT_TIMEOUT_MS for the quick foreground calls.
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.config.get('AGENT_TIMEOUT_MS'),
    );
    try {
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, mode, input }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ServiceUnavailableException(
          `Agent ${workflow} HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      const result = (await res.json()) as AgentRunResult;
      if (result.status === 'failed') {
        throw new ServiceUnavailableException(
          `Agent ${workflow} failed: ${result.errors?.[0] ?? 'unknown error'}`,
        );
      }
      return result;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : 'agent call failed';
      this.logger.warn(`Agent ${workflow} call failed: ${msg}`);
      throw new ServiceUnavailableException(
        `Agent ${workflow} call failed: ${msg}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
