# tasks/todo.md

Working plan for this repo, per CLAUDE.md Task Management:

1. Write the plan here as checkable items **before** implementing.
2. Check in on the plan before starting non-trivial work.
3. Mark items complete (`[x]`) as you go; move finished items to **Done**.
4. Add a summary of what changed and how it was verified to **Review** when a chunk of work lands.

Backlog items below are seeded only from verified defects in the current codebase.

---

## Current Focus

**ERP migration: evertrust-ERP → this repo + hosting to the Mac mini** (plan approved 2026-06-11,
`~/.claude/plans/breezy-knitting-koala.md`; retires Render/Vercel):

- [x] Preflight: both repos main == origin/main; SearXNG baseline committed (8147d72).
- [x] Monorepo imported on branch `migrate-evertrust-erp`: apps/api→`erp-server/`, apps/web→`erp-client/`, `packages/{db,shared}`, root workspace files, infra Dockerfiles; boilerplate (Prisma/TypeORM hello-world + create-next-app) deleted; path rewrites applied; pnpm-lock importer keys regenerated (`--frozen-lockfile` verified).
- [x] VERIFIED on the mini: `pnpm run build` ✅, `typecheck` (4 pkgs) ✅, `lint` ✅, `test` 35 suites / 299 tests ✅; Docker images build green (`evertrust-api:prod` 2.13GB, `evertrust-web:prod` 486MB, NEXT_PUBLIC_API_URL=tailnet host baked).
- [x] New `erp-server/docker-compose.yml`: postgres → `pgvector/pgvector:pg18` (new volume `postgres_data_pg18`), + `erp-api` (3001) + `erp-web` (3000) services; consolidated `.env.example` matching `src/config/env.schema.ts`.
- [x] Docs swept: CLAUDE.md rewritten (monorepo/Drizzle/pnpm), team-hosting.md (ERP on the mini, funnel `/erp` path), drizzle-database agent replaces prisma-database, /db-migrate + /dev-up rewritten.
- [x] Postgres image swap DONE (2026-06-11): pgvector/pgvector:pg18 (PG 18.4, vector 0.8.2, arm64) on new volume `postgres_data_pg18`; dump at `~/erp-pg-migration/alpine-all-2026-06-11.sql` (22 MB, DBs evertrust-erp + litellm, roles intact); restored + verified (litellm 62 tables, virtual key present); ai-stack healthy again (litellm needed `--force-recreate` — stale network ID); 401-keyless verified on gateway/Qdrant/SearXNG. Old alpine volume `erp-server_postgres_data` kept until verified.
- [x] Docker Desktop VM cap raised 3 GB → 4.5 GB (settings-store.json MemoryMiB=4608, Docker restarted, confirmed 4.63 GB).
- [x] Container boot checks: web image serves /login (HTTP 200) standalone; api image has dist/main.js + api-start.sh + curl + tsx; NODE_ENV=production set for erp-api (logger transport).
- [ ] **USER: Render DB external connection string** (Render dashboard → evertrust-db → External Database URL) for the production dump. Then: suspend Render API → `pg_dump --no-owner --no-acl -Fc` → `createdb evertrust` → `pg_restore`.
- [ ] Fill `erp-server/.env` per new `.env.example` (JWT_SECRET re-mint ok; N8N_* webhook URLs from Render dashboard env; values → vault, chmod 600).
- [ ] `docker compose up -d --build` + smoke tests (health db:ok, login over tailnet, tender detail, doc upload, API jest suite).
- [ ] Funnel `/erp` path: `tailscale funnel --bg --set-path /erp 3001`; verify path-strip via `curl …ts.net/erp/health` (fallback: global prefix or Caddy strip).
- [ ] n8n cloud: search for `onrender.com`, repoint arsenal callback to `https://mac-mini-ca-mac.tailc3d837.ts.net/erp/arsenal/runs/callback`, match ARSENAL_INGEST_TOKEN; one arsenal run end-to-end.
- [ ] **USER: teardown LAST** (after smoke + callback green): delete Vercel project, Render service + DB; archive `Ryugwki/evertrust-ERP` with a README pointer.

**AI backend (Hermes gateway) + n8n-cloud migration** (plan approved 2026-06-10; mini side DEPLOYED):

- [x] Local n8n retired (containers removed, volumes kept); `erp-server/docker-compose.yml` = postgres only.
- [x] `ai-stack/` deployed on the mini: LiteLLM gateway (healthy, virtual key minted → `~/.evertrust/n8n-virtual-key.json`), Redis cache, Qdrant (API-key enforced). litellm DB rides erp-postgres via the shared docker network (host.docker.internal is shadowed by brew postgres — see Backlog).
- [x] Gateway smoke-tested: `/v1/models` lists all 5 aliases; `hermes` chat completion returns through the mini's Ollama; Qdrant 401s without key.
- [x] Ollama tuned (KEEP_ALIVE 5m, flash attention, q8 KV) via LaunchAgent + live setenv.
- [x] Funnel LIVE (2026-06-10): gateway at https://mac-mini-ca-mac.tailc3d837.ts.net (443) and Qdrant (:8443), both verified over public HTTPS with auth enforced (401 keyless). Let's Encrypt cert to Sep 2026.
- [x] pmset applied (sleep 0, autorestart) and Docker VM capped at ~3 GB.
- [ ] **USER: vault** — store `ai-stack/.env` values + the n8n virtual key (`~/.evertrust/n8n-virtual-key.json`).
- [ ] **USER: disable key expiry** on mac-mini-ca-mac + evertrusts-macbook-pro (admin console → Machines).
- [ ] **USER: n8n credentials** (browser, evertrustgmbh.app.n8n.cloud, in BOTH projects): OpenAI credential `LiteLLM Gateway (mac-mini)` (key from the virtual-key file, Base URL https://mac-mini-ca-mac.tailc3d837.ts.net/v1) + Qdrant credential `Qdrant (mac-mini)` (https://mac-mini-ca-mac.tailc3d837.ts.net:8443, QDRANT_API_KEY).
- [x] Team on the tailnet (2026-06-10): mac-mini-ca-mac, evertrusts-macbook-pro (Trev/Khanh, 100.93.32.103), lams-macbook-air, iphone-15-pro-max. `TAILNET_OLLAMA` wired to Trev's address; gateway recreated; **fallback chain verified live** (primary dark → mini's hermes3:8b answered).
- [x] TREV LIVE (2026-06-10): his Ollama serves on the tailnet — 5 models (hermes3:8b, deepseek-r1:14b, deepseek-r1:32b, qwen3:8b, nomic-embed-text). Verified through the gateway: `hermes` answered in 1.9 s (vs 60–190 s mini fallback), `deepseek` works.
- [ ] **Phase-4 constraint discovered**: deepseek-r1 is a reasoning model — with low max_tokens the `content` comes back EMPTY (all budget eaten by `reasoning_content`) → would break JSON-parsing nodes. Any node routed to `deepseek` needs max_tokens ≥ ~1500. Alternative to evaluate in the harness: Trev's `qwen3:8b` (supports /no_think) or `deepseek-r1:32b` for quality.
- [ ] Docker Desktop was found QUIT today (whole stack down until restarted) — confirm "Start Docker Desktop when you sign in" is enabled on the mini and tell the team not to quit it.
- [ ] **USER: disable key expiry** for evertrusts-macbook-pro AND mac-mini-ca-mac (admin console → Machines; his key expires in 5 months).
- [x] n8n Phase 2 (2026-06-10): credentials live in REACH ARSENAL (`LiteLLM Gateway (mac-mini)` 2YgDmy9NuLHvOgzJ, Qdrant xaNvwRlsTzu5aF55 — both verified hitting the mini); REACH BAZOOKA test (znawhBKUhRZSlMUq) swapped to `hermes` (3 nodes, byte-diff verified, inactive); LLM AB HARNESS created (BXmnU6ylSBmQ5maz, 15 nodes, inactive).
- [ ] **USER: first harness run** — open LLM AB HARNESS: run "Create Results Sheet" once → paste the returned URL into "Results Config" → click "Run AB Test" → review LLM_AB_Results sheet. This also behaviorally verifies all 3 credential bindings (the n8n API redacts them, so machine verification was impossible).
- [ ] Gateway credential still needed in Trung's personal project before migrating personal-project workflows (n8n creds are project-scoped).
- [ ] INVESTIGATE: production REPLY GLOCK's "OpenAI — Classify Reply" node already has modelId set to `deepseek` (someone changed it manually) — confirm which credential it uses; if it's still the OpenAI credential, that node is broken.
- [ ] n8n cloud Phase 3: KB INGEST workflow + RAG AGENT rework (retrieval first, model second; update IN PLACE — dedup state).
- [ ] n8n cloud Phase 4: tiered node migration per plan (P1 hermes, P2 deepseek, P3 ContractMaker last; web-search + German template nodes stay OpenAI).
- [ ] Verify cache hit-rate behavior on repeated identical calls (cache key header present; hit timing not yet confirmed).
- [ ] Set up the nightly backup job (docs §8) once an external SSD is attached.

**WF-03 LEAD SATELLITE copy 3 — implement real web search on the self-hosted gateway** (plan drafted 2026-06-10; backend choice pending):

Context: the 3 "(Web)" nodes (`Country Profiler (Web)`, `Search Companies (Web)`, `Find Missing Emails (Web)`) rely on the OpenAI node's `builtInTools.webSearch` — a **hosted** tool that only executes on OpenAI's servers. Pointing those nodes at the LiteLLM gateway silently removes all search ability (this is why Phase 4 said "web-search nodes stay OpenAI"). To migrate them, the search loop must run n8n-side: AI Agent node + Chat Model sub-node (gateway) + search tool sub-node.

- [x] **DECISION (user, 2026-06-10)**: SearXNG self-hosted on the mini.
- [x] SearXNG DEPLOYED (2026-06-10): `ai-searxng` (pinned 2026.6.8, no published port, google/startpage engines off) + `ai-searxng-auth` Caddy proxy enforcing `X-Search-Key` (127.0.0.1:8088) in `ai-stack/docker-compose.yml`; funneled at https://mac-mini-ca-mac.tailc3d837.ts.net:10000. Verified: keyless → 401 (local + public), keyed German trade queries → 27–30 JSON results. Secrets `SEARXNG_SECRET`/`SEARXNG_API_KEY` appended to `ai-stack/.env`; `.env.example` + docs/team-hosting.md updated.
- [ ] **USER: vault** — add `SEARXNG_SECRET` + `SEARXNG_API_KEY` (from `ai-stack/.env` on the mini) to the team vault.
- [x] Agent rewiring DONE as **copy 4** (2026-06-11): copy 3 had diverged (32 nodes, company search fanned out to child workflow `WF-03 Segment Worker` via webhook + `wf3_segment_results` data table; only `Country Profiler (Web)` + `Find Missing Emails (Web)` remained as openAi/hosted-webSearch nodes). Both replaced with AI Agent nodes (same names — `$('...')` refs intact) + hermes chat-model sub-nodes (gateway cred bound by ID, Responses API off, temp/maxTokens carried over) + ONE shared `web_search` httpRequestTool (GET …:10000/search, q from AI, format=json, response optimized to results[].title/url/content). Downstream parsers needed NO changes (they already try `output`-as-string first). SDK code generated programmatically (`tasks/wf03-copy3-gen.py` → `tasks/wf03-copy3.sdk.js`, 88KB), validated (35 nodes), created as `tNEr0hgMOLvCs03Y` in REACH ARSENAL. NOTE: `update_workflow` on copy 3 was blocked by an MCP schema mismatch (live server wants an undocumented `operations` array) — hence create-as-copy-4; copy 3 left untouched as reference.
- [x] VERIFIED: hermes3:8b through the gateway returns proper `tool_calls` (`finish_reason: tool_calls`, called web_search with a sane query) — the agent loop assumption holds.
- [ ] **USER: n8n credential** — the Header Auth cred you created sits in your PERSONAL project (only "Header Auth account 1/2/3" exist there; REACH ARSENAL has none). Create it again INSIDE REACH ARSENAL (Credentials → New → Header Auth: name `SearXNG (mac-mini)`, header `X-Search-Key`, value = `SEARXNG_API_KEY` from ai-stack/.env), then open copy 4 → `web_search` node → select it.
- [ ] **USER: check Google creds in copy 4** — auto-assign picked personal-project "Google Drive OAuth2 API"/"Google Sheets OAuth2 API"; if the 6 Drive/Sheets nodes show credential warnings, switch them to the ": Hanna" team creds.
- [ ] **USER: enable "Available in MCP"** on `WF-03 Segment Worker (fan-out child)` (`mW1FZfk7OaM1utBS`, ACTIVE) — it does the heavy company search (the DEEPSEEK node from the screenshot) and still uses hosted webSearch; same agent+SearXNG rewiring needed there next.
- [x] DIAGNOSED copy 4 manual-run failure (2026-06-11, execution 5399): `Decide: Should Hunt?` dies at exactly 60s with "Unknown error". Root cause: `$('Parse Webhook Body').item` referenced on a path where that node never executed — n8n cloud's external Code-node task runner resolves node references OUTSIDE the user script, so the in-code try/catch can't catch it; the data request hangs and the 60s runner timeout kills the task. Fix: pull meta from `$('Valid Payload?').first()` (executes on BOTH entry paths). Patched in `tasks/wf03-copy3-gen.py` + regenerated `wf03-copy3.sdk.js`; copy 4 itself needs the manual paste (MCP update_workflow still schema-broken).
- [ ] **USER: paste the fixed code** into `Decide: Should Hunt?` in copy 4 (snippet provided in chat 2026-06-11).
- [ ] **WARNING — same bug is LIVE in the ACTIVE original LEAD SATELLITE (and copy 3)**: every Drive-poll-triggered run takes the path where `Parse Webhook Body` never executes → same 60s hang in `Decide: Should Hunt?`. Apply the same paste-fix to the original (its drive-triggered hunts are silently failing).
- [x] **FIRST END-TO-END SEAR RUN SUCCEEDED** (2026-06-11, execution 5405, 6m18s, POLAND CS 2027 / Cyber security): Drive-trigger test → config → static PL profile → Build Search Query (after `.item`→`.first()` paste-fix + region "Warszawa, Kraków" + maxToolCalls 20 in config.json) → fan-out to segment worker → parse/validate → leads sheet created + rows appended (sheet 1UVC-Qv8DqcWVsDbnuRcUXYe90wDx5eBTsnAcJA7XveM). CORRECTION (deep-dive): email recovery contributed NOTHING — BOTH chunks 502'd (the run overlapped the ai-stack teardown for the postgres swap; gateway back at 09:58:34, run ended 09:58:24) and `web_search` has never been invoked by any execution yet → the SearXNG credential binding on the web_search node is STILL UNVERIFIED.
- [ ] **USER: spot-check the leads sheet** — CONFIRMED degraded (exec 5405 analysis): the old segment worker (DEEPSEEK, hosted webSearch non-functional on the gateway) returned `{"leads":[]}` for **92 of 111 segments** and only 28 memory-derived leads total (max 3/segment, ~2s/segment = zero actual searching); validation kept 15. The fan-out itself worked perfectly (111 segments, 81 PL cities, all done in 3.2 min). Lead volume/authenticity is blocked ONLY on the worker rewiring → **USER: toggle "Available in MCP" on `WF-03 Segment Worker` (`mW1FZfk7OaM1utBS`)**.
- [ ] After worker rewiring: re-tune nationwide runs (a REAL searching worker at 111 segments won't fit the 45-min wait cap — test with `"region": "Warszawa, Kraków"` first, then raise `maxWaitMs`/cap `maxNationwideCities` for country sweeps); periodically purge stale rows from `wf3_segment_results` (342 old rows present; Reshape filters by runId so harmless, but it grows).
- [ ] Watch ai-litellm memory: 824MiB/1GiB (80%) after the ERP services moved onto the mini — if 502s recur without restarts, raise mem_limit; VM cap raise to 4.5 GB is tracked in the ERP migration block.

## Backlog

- [x] ~~Fix Prisma config~~ / ~~Pick ONE ORM~~ / ~~port collision~~ / ~~add tests~~ — all RESOLVED by the 2026-06-11 migration: the boilerplate was replaced by the real ERP (Drizzle ORM, PORT env default 3001, 35 jest suites). Prisma/TypeORM are gone from the repo.
- [ ] **TLS for the ERP UI / API on the tailnet** (`tailscale serve`): would upgrade laptop access from plain HTTP to HTTPS and allow COOKIE_SECURE=true (see docs/team-hosting.md §9).
- [ ] **Consolidate the two Postgreses on the mini.** Homebrew postgresql@18 owns loopback 5432 (something actively connects to it) while Docker erp-postgres owns the published port — `localhost:5432` means different DBs depending on where you stand. Decide: retire brew postgres (move whatever uses it into the container) or make brew the ERP DB and drop the container. Until then: containers use the docker network, laptops use the Tailscale name.
- [ ] **Old n8n volumes cleanup.** `erp-server_n8n_data`, `erp-server_n8n_postgres_data`, `erp-server_pgadmin_data` still on disk; delete after confirming nothing local is needed (n8n is cloud now).

## Done

- [x] 2026-06-10 — Claude Code project setup: CLAUDE.md project context, 4 subagents, 4 slash commands, permissions in `.claude/settings.json`, tasks/ files, launch.json fix, `.DS_Store` gitignore entry.
- [x] 2026-06-10 — Compose hardening for the shared Mac mini stack (see Current Focus checked items). Resolved former backlog items: volume-path decision (postgres 18 pinned + constraint comment in compose), dead n8n basic-auth removed, obsolete `version:` key removed, `.env.example` created.

## Review

**2026-06-10 — Shared-infra compose hardening.** `erp-server/docker-compose.yml` rewritten for the Mac mini hosting model (Tailscale hostname `mac-mini-ca-mac.tailc3d837.ts.net` as canonical `HOST_NAME`); `.env.example`, `docs/team-hosting.md`, `synchronize: false`, and `.claude` doc sync. Verified: `docker compose config` renders cleanly with a throwaway env file and fails fast with each `${VAR:?}` message without one; `npm run build` passes after the app.module.ts change. Stack `up` deliberately NOT re-run locally (existing local n8n volume holds the old encryption key; see docs §11). Cutover on the mini is a human step.
