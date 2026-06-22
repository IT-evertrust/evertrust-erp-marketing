import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Single postgres.js connection pool for the process. DATABASE_URL is required.
const url = process.env.DATABASE_URL!;

// Supabase's SESSION pooler (the live DATABASE_URL, …pooler.supabase.com:5432) caps
// TOTAL clients across every connection at `pool_size` (15). postgres.js defaults to
// `max: 10`, so a single live instance nearly exhausts that budget — and during a
// deploy the OLD container still holds its pool while the NEW one boots + migrates,
// blowing past 15 with `EMAXCONNSESSION: max clients reached in session mode`. Cap the
// pool small (override per-instance with DATABASE_POOL_MAX) and let idle connections
// return to the pooler so overlapping deploys + migrations fit under the cap.
const max = Number(process.env.DATABASE_POOL_MAX) || 5;

// Prepared statements are unsafe on a TRANSACTION pooler (port 6543 / pgbouncer=true)
// because successive statements may land on different backends. Auto-disable them there;
// honour an explicit DATABASE_PREPARE=false override. Session pooler + direct connections
// keep prepared statements (the default), so current session-mode deploys are unchanged.
const isTransactionPooler = /:6543\b/.test(url) || /[?&]pgbouncer=true\b/.test(url);
const prepare =
  process.env.DATABASE_PREPARE === 'false' ? false : !isTransactionPooler;

const client = postgres(url, {
  max,
  prepare,
  idle_timeout: 20, // seconds: release idle connections back to the pooler
  connect_timeout: 30, // seconds: fail fast instead of hanging on a saturated pooler
});

export const db = drizzle(client, { schema });
