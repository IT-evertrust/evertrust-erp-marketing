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
3. Apply it. DATABASE_URL must be in the SHELL environment (the db scripts dotenv-load only
   packages/db/.env, which doesn't exist — erp-server/.env is NOT picked up):
   `cd /Users/macco/Documents/evertrust-erp-marketing && DATABASE_URL='postgresql://…' corepack pnpm --filter @evertrust/db db:migrate`
   (ask the user for the target URL by NAME — never read .env). The target must be a per-dev
   database (erp_<yourname>), never the shared `evertrust` DB directly (the erp-api container
   migrates that one itself on restart).
4. Verify nothing else broke:
   `corepack pnpm --filter @evertrust/api test`
5. Report the new migration file, tables/columns affected, and any warnings verbatim.

NEVER hand-edit a migration that has already been applied anywhere, and NEVER run destructive
commands (DROP DATABASE, compose down -v) — the litellm and per-dev databases share this Postgres.
If the migration fails, show the exact error and stop; do not retry destructively.
