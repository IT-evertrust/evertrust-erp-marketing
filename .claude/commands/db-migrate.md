---
description: Create and apply a Prisma migration for erp-server, then regenerate the client
argument-hint: <migration-name>
---

Run a Prisma migration named "$ARGUMENTS". If no name was given, ask for one and stop.

1. Preflight — verify Prisma is actually wired up:
   Read /Users/macco/Documents/evertrust-erp-marketing/erp-server/prisma/schema.prisma and check
   whether the `datasource db` block has a `url` configured (or whether an
   erp-server/prisma.config.ts with a datasource url exists — Prisma 7 expects the url there and
   does NOT auto-load .env). If neither is configured, STOP and tell the user:
   "Prisma is not wired up yet — the datasource has no url, so migrations cannot run."
   Do not attempt workarounds or invent configuration.
2. Ensure the database is up and healthy:
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && docker compose ps postgres`
   The postgres service (container erp-postgres) must show (healthy). If not, suggest running
   /dev-up first and stop.
3. Create and apply the migration:
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && npm run prisma:migrate -- --name $ARGUMENTS`
4. Regenerate the Prisma client:
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && npm run prisma:generate`
5. Report the migration name, the new directory under erp-server/prisma/migrations/, and any
   warnings from the Prisma CLI verbatim.

NEVER run `prisma migrate reset` (it drops the database) — not even if Prisma suggests it.
If the migration fails, show the exact error and stop; do not retry destructively.
