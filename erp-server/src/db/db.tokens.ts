import type { db } from '@evertrust/db';

// Injection token for the shared Drizzle client. Using a token (not the concrete
// import) lets services depend on an interface and be unit-tested with a mock.
export const DB = Symbol('DB');

// The runtime type of the @evertrust/db client, re-exported for typed injection.
export type DbClient = typeof db;
