---
description: Start the local Docker dev stack (postgres + n8n; pgAdmin on demand); pass "full" to also start both dev servers
argument-hint: [full]
---

Start the local development stack. Arguments: $ARGUMENTS

0. Preflight: if the user wants the TEAM's shared stack, nothing needs starting — it runs 24/7
   on the Mac mini (http://mac-mini-ca-mac.tailc3d837.ts.net:5678, Postgres on
   mac-mini-ca-mac.tailc3d837.ts.net:5432; see docs/team-hosting.md). This command is for a
   laptop-LOCAL stack.
1. Start the Docker services:
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && docker compose up -d`
   If this fails with a "required variable" interpolation error, erp-server/.env is missing or
   incomplete — tell the user to copy erp-server/.env.example to erp-server/.env and fill in the
   named variable (do NOT read or edit .env yourself), then stop.
2. Wait for healthchecks. Poll with:
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && docker compose ps`
   until postgres, n8n-postgres AND n8n report (healthy). If a service stays unhealthy after
   ~90s, show its logs (`cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && docker compose logs <service>`) and stop — do not continue.
3. Report each service with its host port:
   - postgres (erp-postgres): localhost:5432
   - n8n (erp-n8n): http://localhost:5678
   - n8n-postgres: 127.0.0.1:5433 (loopback only)
   - pgAdmin is NOT started by default; on demand:
     `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && docker compose --profile tools up -d pgadmin` → http://localhost:5050

Only if $ARGUMENTS contains "full", also start the dev servers AFTER step 2 passes:

4. Start the API first — it must claim port 3000 before the client (the NestJS port is hardcoded):
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && npm run start:dev` (in background)
   Note: this crashes if no Postgres is reachable at DB_HOST:5432, which is why step 2 must pass first.
5. Then start the client:
   `cd /Users/macco/Documents/evertrust-erp-marketing/erp-client && npm run dev` (in background)
   Both apps default to port 3000; because the server started first, Next.js auto-bumps the
   client to 3001. Confirm the actual port from the next dev output rather than assuming.
6. Report final URLs: API http://localhost:3000, client http://localhost:3001 (or as observed).
