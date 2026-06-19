import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Jest globalSetup — runs ONCE per `jest` invocation, in the main process. Spins up a
// throwaway pgvector Postgres (pg18 — the prod image, so migration 0000's
// `CREATE EXTENSION vector` succeeds), applies the real Drizzle migrations, and exposes
// the connection URL to the test workers via process.env (set before workers fork → they
// inherit it; per-process-tree, so concurrent `jest` runs never collide). The container
// handle is stashed on globalThis for globalTeardown (same process). Testcontainers'
// Ryuk reaper also force-removes the container if the process dies before teardown.
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg18').start();
  const url = container.getConnectionUri();

  // Apply migrations once with a short-lived connection. The migrations folder is the
  // single source of truth shared with prod (`packages/db/drizzle`).
  const migrationClient = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), {
      migrationsFolder: join(__dirname, '../../packages/db/drizzle'),
    });
  } finally {
    await migrationClient.end();
  }

  process.env.TEST_DATABASE_URL = url;
  (globalThis as { __PG_CONTAINER__?: unknown }).__PG_CONTAINER__ = container;
}
