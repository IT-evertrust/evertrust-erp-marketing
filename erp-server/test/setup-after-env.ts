import { closeDb, resetDb } from './real-db';

// Runs in every worker, for every spec file. A global beforeEach empties the schema so
// each test starts clean (registered here first → runs before any file-level beforeEach,
// so a spec's own seeding happens on a truncated DB). afterAll closes this file's
// connection; the container itself is torn down once in globalTeardown.
beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});
