import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migrations run DDL and should NOT compete for the runtime app's slots on Supabase's
// session pooler (hard-capped at 15 clients). Prefer MIGRATION_DATABASE_URL — point it
// at the Supabase DIRECT connection (db.<ref>.supabase.co:5432, no client cap) — and
// fall back to DATABASE_URL when it is unset.
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url,
  },
});
