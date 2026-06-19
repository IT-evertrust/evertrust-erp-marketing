import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Jest globalTeardown — stops the container started in globalSetup (same process, so the
// handle is on globalThis). Best-effort: Ryuk reaps the container anyway if this fails.
export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as { __PG_CONTAINER__?: StartedPostgreSqlContainer })
    .__PG_CONTAINER__;
  if (container) await container.stop();
}
