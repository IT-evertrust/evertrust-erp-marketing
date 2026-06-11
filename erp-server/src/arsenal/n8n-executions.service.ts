import { Injectable, Logger } from '@nestjs/common';
import type {
  ArsenalExecutionDto,
  ArsenalExecutionsDto,
  ArsenalStage,
} from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';

// Stage -> n8n workflow id (the live REACH ARSENAL ids, verified by the read-only
// audit). AIM is excluded — it's the launch, not an arsenal stage; its status comes
// from the campaign's deploy state, not executions.
export const STAGE_WORKFLOW_ID: Record<ArsenalStage, string> = {
  LEAD_SATELLITE: 'fvilklqj7XAOLlLL',
  AMMO_FORGE: 'n2kA3j6uupUAe42A',
  REACH_BAZOOKA: 'qVvT6WLTYxtfubUg',
  REPLY_GLOCK: 'Vi9x1RhdRIaePZPQ',
  SLEEPER_GRENADE: '4GgPmoulQDgDWtej',
};

// Minimal shape of an n8n public-API execution (GET /api/v1/executions).
interface N8nExecution {
  id: string;
  status?: string; // 'success' | 'error' | 'running' | 'waiting' | 'crashed' | ...
  finished?: boolean;
  startedAt?: string | null;
  stoppedAt?: string | null;
  // 'trigger' | 'webhook' | 'manual' | 'error' | ... — 'error' means this is the
  // workflow's error-handler run (a real run failed and triggered it).
  mode?: string;
}

const REQUEST_TIMEOUT_MS = 8_000;

// Phase 7+ — real run-state sync. Reads the n8n public executions API (READ-ONLY) to
// surface each stage's true status (RUNNING / SUCCESS / ERROR / IDLE) so the Growth
// Engine strip can animate running->end for real instead of the dispatch proxy.
// Graceful: blank N8N_API_URL/KEY => { configured:false }; any per-stage fetch error
// degrades that stage to IDLE and is logged — the endpoint never throws.
@Injectable()
export class N8nExecutionsService {
  private readonly logger = new Logger(N8nExecutionsService.name);

  constructor(private readonly config: AppConfigService) {}

  isConfigured(): boolean {
    return (
      this.config.get('N8N_API_URL').trim().length > 0 &&
      this.config.get('N8N_API_KEY').trim().length > 0
    );
  }

  async getStatuses(): Promise<ArsenalExecutionsDto> {
    if (!this.isConfigured()) return { configured: false, stages: [] };
    const base = this.config.get('N8N_API_URL').trim().replace(/\/+$/, '');
    const key = this.config.get('N8N_API_KEY').trim();

    const entries = Object.entries(STAGE_WORKFLOW_ID) as [ArsenalStage, string][];
    const stages = await Promise.all(
      entries.map(([stage, workflowId]) =>
        this.statusFor(base, key, stage, workflowId),
      ),
    );
    return { configured: true, stages };
  }

  // Latest execution status for one stage's workflow. Newest-first. An execution is
  // ACTIVELY running only if it has not stopped yet (no stoppedAt) AND its status is
  // running/waiting/new — n8n sets finished:false on ERRORED executions too, so
  // `finished` alone is NOT a running signal (an errored run is stopped, not live).
  // If a genuinely-active exec exists -> RUNNING; else the newest decides
  // SUCCESS/ERROR (mode 'error' = the workflow's error-handler fired -> a real run
  // failed -> ERROR); none -> IDLE.
  private async statusFor(
    base: string,
    key: string,
    stage: ArsenalStage,
    workflowId: string,
  ): Promise<ArsenalExecutionDto> {
    const idle: ArsenalExecutionDto = {
      stage,
      status: 'IDLE',
      startedAt: null,
      finishedAt: null,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(
        `${base}/api/v1/executions?workflowId=${encodeURIComponent(workflowId)}&limit=3`,
        {
          headers: { 'X-N8N-API-KEY': key, accept: 'application/json' },
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        this.logger.warn(`n8n executions ${stage}: HTTP ${res.status}`);
        return idle;
      }
      const json = (await res.json()) as { data?: N8nExecution[] };
      const execs = json.data ?? [];
      if (execs.length === 0) return idle;

      // Actively running = hasn't stopped AND is in a live status. A present
      // stoppedAt means it's done (success OR error) — never "running".
      const active = execs.find(
        (e) =>
          !e.stoppedAt &&
          (e.status === 'running' ||
            e.status === 'waiting' ||
            e.status === 'new' ||
            e.status === undefined),
      );
      if (active) {
        return {
          stage,
          status: 'RUNNING',
          startedAt: active.startedAt ?? null,
          finishedAt: null,
        };
      }
      const latest = execs[0]!;
      const errored =
        latest.status === 'error' ||
        latest.status === 'crashed' ||
        latest.mode === 'error';
      return {
        stage,
        status: errored ? 'ERROR' : 'SUCCESS',
        startedAt: latest.startedAt ?? null,
        finishedAt: latest.stoppedAt ?? null,
      };
    } catch (err) {
      this.logger.warn(
        `n8n executions ${stage} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      return idle;
    } finally {
      clearTimeout(timeout);
    }
  }
}
