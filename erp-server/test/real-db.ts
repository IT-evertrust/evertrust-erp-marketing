import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { schema } from '@evertrust/db';
import type { DbClient } from '../src/db/db.tokens';
import type { AppConfigService } from '../src/config/app-config.service';
import { WorkflowConfigService } from '../src/arsenal/workflow-config.service';
import { SendersService } from '../src/arsenal/senders.service';
import type { GoogleAccountsService } from '../src/google/google-accounts.service';

// ---------------------------------------------------------------------------
// Real-Postgres test harness. Replaces the old in-memory fake: every spec now runs
// against the throwaway pgvector container globalSetup started, so the REAL SQL engine
// (ordering, aggregates, ON CONFLICT, types, unique/NOT NULL) backs the services.
//
// Connection: a per-test-file, single-connection client to the container.
//   - max: 1 — the suite runs serially (jest maxWorkers: 1), so one connection is
//     enough and keeps truncate-then-seed-then-assert deterministic.
//   - session_replication_role = replica — disables FK *trigger* enforcement so a spec
//     can seed a child row (an outreach_message, a prospect) WITHOUT first building its
//     whole parent graph, exactly as the fake allowed. Unique/PK/NOT NULL/type checks
//     stay ON, so the real engine still catches what matters.
//
// Isolation: resetDb() TRUNCATEs every app table; it runs in a global beforeEach
// (test/setup-after-env.ts) so each test starts from an empty schema.
// ---------------------------------------------------------------------------

let _sql: Sql | null = null;
let _db: DbClient | null = null;

function dbUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set — the jest globalSetup (test/global-setup.ts) must ' +
        'start the Postgres container before any spec runs.',
    );
  }
  return url;
}

// The shared client for this test file. Lazily created on first use; closed in the
// global afterAll (setup-after-env.ts).
export function getDb(): DbClient {
  if (!_db) {
    _sql = postgres(dbUrl(), {
      max: 1,
      onnotice: () => {},
      connection: { session_replication_role: 'replica' },
    });
    _db = drizzle(_sql, { schema }) as unknown as DbClient;
  }
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
  }
}

// Empty every application table (RESTART IDENTITY, CASCADE). The drizzle bookkeeping
// lives in its own `drizzle` schema, so truncating `public` never touches migrations.
export async function resetDb(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename)
          || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}

// Insert seed rows into a table and return the inserted rows. Thin wrapper over
// db.insert().values().returning() so specs read declaratively: await seed(schema.x, [..]).
// Accepts a single row or an array; a no-op on an empty array. Loosely typed on purpose
// — these are test fixtures, not prod call sites, so the schema's strict insert types
// would only get in the way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seed(table: any, rows: any): Promise<any[]> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) return [];
  return (getDb() as any).insert(table).values(list).returning();
}

// Read all rows of a table. The real-db analogue of the fake's insertedInto(); order in
// the query itself when order matters (real rows have no implicit ordering).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rowsOf(table: any): Promise<any[]> {
  return (getDb() as any).select().from(table);
}

// A stub GoogleAccountsService whose listForOrg returns the supplied accounts — only
// `email`/`status` matter to SendersService.list (which keys its CONNECTED filter off
// them). Defaults to no connected accounts, which is correct for the resolve()-only
// consumers (WorkflowConfigService) that never call list().
export function fakeGoogleAccounts(
  connected: { email: string; status?: string }[] = [],
): GoogleAccountsService {
  return {
    listForOrg: async () =>
      connected.map((a) => ({ email: a.email, status: a.status ?? 'CONNECTED' })),
  } as unknown as GoogleAccountsService;
}

// A real WorkflowConfigService over the real db + a config stub. With no seeded
// workflow_config row, every resolver falls back to env (the config stub). The
// SendersService it depends on is constructed over the SAME db, so the org sender list
// resolves to the product DEFAULT_SENDERS until a spec seeds org_senders. Use in specs
// that construct the resolver-consuming services (arsenal, campaigns, n8n-executions).
export function makeWorkflowConfig(
  db: DbClient,
  config: AppConfigService,
): WorkflowConfigService {
  return new WorkflowConfigService(
    db,
    config,
    new SendersService(db, fakeGoogleAccounts()),
  );
}
