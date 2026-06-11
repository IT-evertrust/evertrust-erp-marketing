---
description: Generate and apply a Drizzle migration from packages/db schema changes
argument-hint: [migration-note]
---

Run the Drizzle migration workflow. Optional context from the user: "$ARGUMENTS"

1. Ensure the database is up and healthy:
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && docker compose ps postgres`
   The postgres service (container erp-postgres) must show (healthy). If not, suggest running
   /dev-up first and stop.
2. Generate the migration from schema changes:
   `cd /Users/macco/Documents/evertrust-erp-marketing && corepack pnpm --filter @evertrust/db db:generate`
   Show the user the generated SQL file under packages/db/drizzle/ and WAIT for a quick review
   if it contains DROP or ALTER ... TYPE statements.
   Caveat: enum value renames/removals don't work incrementally with drizzle-kit — if the
   diff touches enum values, stop and discuss squashing (dev-only) instead.
3. Apply it:
   `cd /Users/macco/Documents/evertrust-erp-marketing && corepack pnpm --filter @evertrust/db db:migrate`
   DATABASE_URL decides the target — from a laptop that must be your per-dev database
   (erp_<yourname>), never the shared `evertrust` DB directly (the erp-api container migrates
   that one itself on restart).
4. Verify nothing else broke:
   `corepack pnpm --filter @evertrust/api test`
5. Report the new migration file, tables/columns affected, and any warnings verbatim.

NEVER hand-edit a migration that has already been applied anywhere, and NEVER run destructive
commands (DROP DATABASE, compose down -v) — the litellm and per-dev databases share this Postgres.
If the migration fails, show the exact error and stop; do not retry destructively.
