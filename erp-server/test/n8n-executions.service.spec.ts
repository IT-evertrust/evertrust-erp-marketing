import { N8nExecutionsService } from '../src/arsenal/n8n-executions.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, makeWorkflowConfig } from './real-db';

// The poller reads n8n's public executions API and maps the latest execution to
// RUNNING / SUCCESS / ERROR / IDLE for the Growth Engine strip. These tests pin the
// mapping — in particular the regression where an ERRORED execution (n8n sets
// finished:false on those) was mis-read as "running" forever.

function makeConfig(url: string, key: string): AppConfigService {
  return {
    get: (k: string) =>
      k === 'N8N_API_URL' ? url : k === 'N8N_API_KEY' ? key : '',
  } as unknown as AppConfigService;
}

// The base URL now resolves via WorkflowConfigService (stored override ?? env). With
// no seeded workflow_config row it falls back to env (the config stub) — so the
// mapping tests behave exactly as before. The API key stays env-only.
function makeExecSvc(url: string, key: string): N8nExecutionsService {
  const config = makeConfig(url, key);
  const db = getDb();
  return new N8nExecutionsService(config, makeWorkflowConfig(db, config));
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Mock fetch so every stage's request returns the same execution list.
function mockExecutions(data: unknown[], ok = true, httpStatus = 200) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok,
    status: httpStatus,
    json: async () => ({ data }),
  }) as unknown as typeof fetch;
}

async function bazookaStatus(data: unknown[]) {
  mockExecutions(data);
  const svc = makeExecSvc('https://n8n.test', 'k');
  const res = await svc.getStatuses();
  expect(res.configured).toBe(true);
  return res.stages.find((s) => s.stage === 'REACH_BAZOOKA')!;
}

describe('N8nExecutionsService.getStatuses — status mapping', () => {
  it('returns { configured:false } when the API is not wired up', async () => {
    const svc = makeExecSvc('', '');
    expect(await svc.getStatuses()).toEqual({ configured: false, stages: [] });
  });

  // THE REGRESSION: an errored run has finished:false but a stoppedAt — it is DONE,
  // not running. The newest exec is the error-handler (mode:error), which signals a
  // real failure -> ERROR (never RUNNING, never a misleading SUCCESS).
  it('maps an errored run (finished:false + stoppedAt, error-handler newest) to ERROR', async () => {
    const s = await bazookaStatus([
      {
        id: '3768',
        status: 'success',
        finished: true,
        startedAt: '2026-06-02T06:01:25.264Z',
        stoppedAt: '2026-06-02T06:01:25.928Z',
        mode: 'error',
      },
      {
        id: '3764',
        status: 'error',
        finished: false,
        startedAt: '2026-06-02T06:00:00.191Z',
        stoppedAt: '2026-06-02T06:01:25.121Z',
        mode: 'trigger',
      },
    ]);
    expect(s.status).toBe('ERROR');
  });

  it('maps a genuinely active run (running, no stoppedAt) to RUNNING', async () => {
    const s = await bazookaStatus([
      {
        id: '9001',
        status: 'running',
        finished: false,
        startedAt: '2026-06-02T07:00:00.000Z',
        stoppedAt: null,
      },
    ]);
    expect(s.status).toBe('RUNNING');
    expect(s.startedAt).toBe('2026-06-02T07:00:00.000Z');
  });

  it('maps a clean finished run to SUCCESS', async () => {
    const s = await bazookaStatus([
      {
        id: '9002',
        status: 'success',
        finished: true,
        startedAt: '2026-06-02T08:00:00.000Z',
        stoppedAt: '2026-06-02T08:00:30.000Z',
        mode: 'trigger',
      },
    ]);
    expect(s.status).toBe('SUCCESS');
    expect(s.finishedAt).toBe('2026-06-02T08:00:30.000Z');
  });

  it('does NOT let an older stopped exec force RUNNING (newest wins)', async () => {
    const s = await bazookaStatus([
      {
        id: 'new',
        status: 'success',
        finished: true,
        startedAt: '2026-06-02T09:00:00.000Z',
        stoppedAt: '2026-06-02T09:00:10.000Z',
        mode: 'trigger',
      },
      // older errored run — stopped, must not be treated as running
      {
        id: 'old',
        status: 'error',
        finished: false,
        startedAt: '2026-06-02T08:00:00.000Z',
        stoppedAt: '2026-06-02T08:01:00.000Z',
        mode: 'trigger',
      },
    ]);
    expect(s.status).toBe('SUCCESS');
  });

  it('degrades a stage to IDLE on a non-2xx n8n response (never throws)', async () => {
    mockExecutions([], false, 401);
    const svc = makeExecSvc('https://n8n.test', 'k');
    const res = await svc.getStatuses();
    expect(res.configured).toBe(true);
    expect(res.stages.every((s) => s.status === 'IDLE')).toBe(true);
  });
});
