---
description: Start the Docker ERP stack (postgres + api + web); pass "dev" to run api/web as local dev servers instead
argument-hint: [dev]
---

Start the EverTrust ERP stack. Arguments: $ARGUMENTS

0. Preflight: the TEAM's shared stack runs 24/7 on the Mac mini
   (web http://mac-mini-ca-mac.tailc3d837.ts.net:3000, API :3001, Postgres :5432 —
   see docs/team-hosting.md). This command is for running the stack on THIS machine.

Default (containers):
1. `cd /Users/macco/Documents/evertrust-erp-marketing/erp-server && docker compose up -d`
   If this fails with a "required variable" interpolation error, erp-server/.env is missing or
   incomplete — tell the user to copy erp-server/.env.example to erp-server/.env and fill in the
   named variable (do NOT read or edit .env yourself), then stop.
2. Wait for healthchecks: poll `docker compose ps` until postgres, erp-api AND erp-web report
   (healthy). The api container runs idempotent migrate + seed on start, so first boot takes
   ~30s extra. If a service stays unhealthy after ~120s, show its logs
   (`docker compose logs <service>`) and stop.
3. If the ai-stack should also run: `cd ../ai-stack && docker compose up -d` (AFTER erp-server —
   it joins this stack's network).
4. Report: web http://localhost:3000, API http://localhost:3001/health, postgres localhost:5432.

Only if $ARGUMENTS contains "dev", run api/web as watch-mode dev servers instead of containers:
5. Start ONLY postgres in Docker: `cd erp-server && docker compose up -d postgres`
6. API: `cd /Users/macco/Documents/evertrust-erp-marketing && corepack pnpm --filter @evertrust/api start:dev`
   (in background; reads PORT from env, default 3001; needs DATABASE_URL pointing at a reachable
   Postgres — per-dev DB on the mini or the local container).
7. Web: `corepack pnpm --filter @evertrust/web dev` (in background; port 3000; reads
   NEXT_PUBLIC_API_URL from erp-client/.env.local, default http://localhost:3001).
8. Report final URLs as observed from the dev-server output.
