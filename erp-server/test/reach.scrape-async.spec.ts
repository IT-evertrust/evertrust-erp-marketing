import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { ReachService } from '../src/reach/reach.service';
import { ReachRepository } from '../src/reach/reach.repository';
import type { ReachAgentClient, AgentRunResult } from '../src/reach/reach.agent';
import type { GmailSenderService } from '../src/reach/gmail-sender.service';
import type { AppConfigService } from '../src/config/app-config.service';
import type { NichesService } from '../src/niches/niches.service';
import type { WorkflowConfigService } from '../src/arsenal/workflow-config.service';
import { getDb } from './real-db';

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCRAPE_TIMEOUT_MS = 1_800_000;

// A config stub that returns the long background-scrape timeout as a NUMBER (the
// real AppConfigService coerces env -> number; isScrapeStale does arithmetic on it).
function makeConfig(): AppConfigService {
  return {
    get: (k: string) => (k === 'REACH_SCRAPE_TIMEOUT_MS' ? SCRAPE_TIMEOUT_MS : ''),
  } as unknown as AppConfigService;
}

function agentResult(leads: Array<Record<string, unknown>>): AgentRunResult {
  return {
    job_id: 'job-1',
    workflow: 'reach.lead_satellite',
    status: 'success',
    output: { leads },
    metrics: {},
    errors: [],
  };
}

// A deferred promise so a test can hold the background run "in flight".
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function build(agentRun: ReachAgentClient['run']) {
  const db = getDb();
  const repo = new ReachRepository(db);
  const agent = { run: agentRun, isConfigured: () => true } as unknown as ReachAgentClient;
  const gmail = {} as unknown as GmailSenderService;
  const niches = {
    findOrCreate: jest.fn(async (_org: string, name: string) => ({
      id: 'niche-1',
      name,
      slug: 'led',
    })),
    targets: jest.fn(async () => []),
  } as unknown as NichesService;
  const workflowConfig = {
    getLeadScraper: jest.fn(async () => ({
      leadTarget: null,
      maxQueries: null,
      minScore: null,
    })),
  } as unknown as WorkflowConfigService;
  const service = new ReachService(
    repo,
    agent,
    gmail,
    makeConfig(),
    niches,
    workflowConfig,
  );
  return { service, repo, db };
}

async function makeAim(repo: ReachRepository) {
  return repo.createAim(ORG, {
    name: 'Test Aim',
    niche: 'LED',
    region: 'Anywhere',
  } as Parameters<ReachRepository['createAim']>[1]);
}

async function waitForStatus(
  service: ReachService,
  aimId: string,
  status: string,
  timeoutMs = 3000,
) {
  const start = Date.now();
  for (;;) {
    const aims = await service.getAims(ORG);
    const aim = aims.find((a) => a.id === aimId);
    if (aim?.status === status) return aim;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`aim ${aimId} never reached ${status} (last=${aim?.status})`);
    }
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('ReachService — async scrape', () => {
  it('returns RUNNING immediately with a server-seeded ETA (no leads in the response)', async () => {
    // agent never resolves here → the run stays in flight, so we observe the
    // immediate RUNNING return without the background completing.
    const d = deferred<AgentRunResult>();
    const { service, repo } = build(jest.fn(() => d.promise) as ReachAgentClient['run']);
    const aim = await makeAim(repo);

    const result = await service.scrapeAim(ORG, aim.id);

    expect(result.status).toBe('RUNNING');
    expect(result.scrapeStartedAt).toBeTruthy();
    // leadTarget null → estimate = 60 + 100*4 = 460s.
    expect(result.scrapeEtaSeconds).toBe(460);

    d.resolve(agentResult([])); // let the in-flight run drain
    await waitForStatus(service, aim.id, 'COMPLETED');
  });

  it('saves leads + COMPLETED + records the run duration when the background run finishes', async () => {
    const run = jest.fn(async () =>
      agentResult([{ company: 'Acme GmbH' }, { company: 'Globex AG' }]),
    );
    const { service, repo } = build(run as ReachAgentClient['run']);
    const aim = await makeAim(repo);

    await service.scrapeAim(ORG, aim.id);
    const done = await waitForStatus(service, aim.id, 'COMPLETED');

    expect(done.companies).toBe(2);
    expect(done.scrapeLastSeconds).not.toBeNull();
    expect(done.scrapeLastSeconds).toBeGreaterThanOrEqual(0);
    const leads = await service.getAimLeads(ORG, aim.id);
    expect(leads.map((l) => l.company).sort()).toEqual(['Acme GmbH', 'Globex AG']);
  });

  it('is idempotent: re-triggering while RUNNING does not launch a second run', async () => {
    const d = deferred<AgentRunResult>();
    const run = jest.fn(() => d.promise);
    const { service, repo } = build(run as ReachAgentClient['run']);
    const aim = await makeAim(repo);

    await service.scrapeAim(ORG, aim.id); // starts the run (in flight)
    const second = await service.scrapeAim(ORG, aim.id); // should be a no-op

    expect(second.status).toBe('RUNNING');
    expect(run).toHaveBeenCalledTimes(1);

    d.resolve(agentResult([]));
    await waitForStatus(service, aim.id, 'COMPLETED');
  });

  it('marks FAILED when the background agent run errors', async () => {
    const run = jest.fn(async () => {
      throw new Error('satellite blew up');
    });
    const { service, repo } = build(run as ReachAgentClient['run']);
    const aim = await makeAim(repo);

    await service.scrapeAim(ORG, aim.id);
    const failed = await waitForStatus(service, aim.id, 'FAILED');
    expect(failed.status).toBe('FAILED');
  });

  it('self-heals a stale RUNNING aim to FAILED on getAims (process died mid-run)', async () => {
    const run = jest.fn(async () => agentResult([]));
    const { service, repo, db } = build(run as ReachAgentClient['run']);
    const aim = await makeAim(repo);

    // Simulate a run that started long ago and never finished (e.g. a redeploy
    // killed the background task): RUNNING with a startedAt past the hard cap.
    const stale = new Date(Date.now() - (SCRAPE_TIMEOUT_MS + 200_000));
    await db
      .update(schema.reachAims)
      .set({ status: 'RUNNING', scrapeStartedAt: stale })
      .where(eq(schema.reachAims.id, aim.id));

    const aims = await service.getAims(ORG);
    expect(aims.find((a) => a.id === aim.id)?.status).toBe('FAILED');
  });
});
