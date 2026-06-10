# tasks/todo.md

Working plan for this repo, per CLAUDE.md Task Management:

1. Write the plan here as checkable items **before** implementing.
2. Check in on the plan before starting non-trivial work.
3. Mark items complete (`[x]`) as you go; move finished items to **Done**.
4. Add a summary of what changed and how it was verified to **Review** when a chunk of work lands.

Backlog items below are seeded only from verified defects in the current codebase.

---

## Current Focus

**AI backend (Hermes gateway) + n8n-cloud migration** (plan approved 2026-06-10; mini side DEPLOYED):

- [x] Local n8n retired (containers removed, volumes kept); `erp-server/docker-compose.yml` = postgres only.
- [x] `ai-stack/` deployed on the mini: LiteLLM gateway (healthy, virtual key minted → `~/.evertrust/n8n-virtual-key.json`), Redis cache, Qdrant (API-key enforced). litellm DB rides erp-postgres via the shared docker network (host.docker.internal is shadowed by brew postgres — see Backlog).
- [x] Gateway smoke-tested: `/v1/models` lists all 5 aliases; `hermes` chat completion returns through the mini's Ollama; Qdrant 401s without key.
- [x] Ollama tuned (KEEP_ALIVE 5m, flash attention, q8 KV) via LaunchAgent + live setenv.
- [ ] **USER: enable Funnel on the tailnet** (admin console → Access Controls → nodeAttrs funnel), then `tailscale funnel --bg 4000` + `tailscale funnel --bg --https=8443 6333`. Blocks n8n cloud connectivity.
- [ ] **USER: run** `sudo pmset -a sleep 0 displaysleep 0 disksleep 0 womp 1 autorestart 1 powernap 0` (mini still has sleep=1!).
- [ ] **USER: cap Docker Desktop VM at 3 GB** (Settings → Resources; currently 3.9 GB).
- [ ] **USER: vault** — store `ai-stack/.env` values + the n8n virtual key.
- [ ] Trev onboarding (docs/team-hosting.md §6): Tailscale, Ollama on 0.0.0.0, pull hermes3:8b + deepseek-r1, set `TAILNET_OLLAMA` in ai-stack/.env.
- [ ] n8n cloud Phase 2 (after funnel): create `LiteLLM Gateway (mac-mini)` + `Qdrant (mac-mini)` credentials in BOTH projects; swap REACH BAZOOKA test's 3 nodes (guinea pig); build LLM AB HARNESS.
- [ ] n8n cloud Phase 3: KB INGEST workflow + RAG AGENT rework (retrieval first, model second; update IN PLACE — dedup state).
- [ ] n8n cloud Phase 4: tiered node migration per plan (P1 hermes, P2 deepseek, P3 ContractMaker last; web-search + German template nodes stay OpenAI).
- [ ] Verify cache hit-rate behavior on repeated identical calls (cache key header present; hit timing not yet confirmed).
- [ ] Set up the nightly backup job (docs §8) once an external SSD is attached.

## Backlog

- [ ] **Fix Prisma config (migrations are broken).** `npm run prisma:migrate`, `prisma:migrate:deploy`, and `prisma:studio` in `erp-server` all fail with "The datasource.url property is required in your Prisma config file". Prisma 7 moved the datasource URL out of `schema.prisma` into a `prisma.config.ts`, which does not exist, and the Prisma 7 CLI no longer auto-loads `.env`. Create `/Users/macco/Documents/evertrust-erp-marketing/erp-server/prisma.config.ts` that loads env (dotenv is already a dependency) and supplies the datasource url from `DATABASE_URL` (already named in `erp-server/.env`). Verify with `npm run prisma:migrate`.
- [ ] **Pick ONE ORM.** Both stacks are installed: TypeORM (`typeorm@1.0.0` + `@nestjs/typeorm` + `pg`) is what's actually wired via `TypeOrmModule.forRoot` in `erp-server/src/app.module.ts` (now with `synchronize: false` and zero entity files), while `src/prisma.service.ts` is dead code — never registered in any module. Either: go Prisma (register `PrismaService` as a provider, remove `typeorm`/`@nestjs/typeorm`/`pg` and the TypeORM config, including the hardcoded DB password fallback in `app.module.ts`), or go TypeORM (delete `prisma.service.ts`, `prisma/`, `@prisma/client`, `prisma`, and the `prisma:*` scripts). Don't build features until this is decided.
- [ ] **Resolve the client/server port collision.** `erp-server/src/main.ts` hardcodes `app.listen(3000)` and `erp-client`'s `npm run dev` also defaults to port 3000. Make the server read a `PORT` env var with default 3001 (it currently reads no port env at all), and align `NEXT_PUBLIC_API_URL` in `erp-server/.env` with the new port.
- [ ] **TLS for the n8n editor** (`tailscale serve`): would let us remove `N8N_SECURE_COOKIE: "false"` from the compose file and set `N8N_PROTOCOL: https` (see docs/team-hosting.md §9).
- [ ] **Add a real test setup to `erp-server`.** `npm test` is a failing stub (`echo "Error: no test specified" && exit 1`); there is no jest config, no `*.spec.ts`, no `test/` dir. Add jest + `@nestjs/testing`, a first spec for `app.controller.ts`, and replace the `test` script.
- [ ] **Consolidate the two Postgreses on the mini.** Homebrew postgresql@18 owns loopback 5432 (something actively connects to it) while Docker erp-postgres owns the published port — `localhost:5432` means different DBs depending on where you stand. Decide: retire brew postgres (move whatever uses it into the container) or make brew the ERP DB and drop the container. Until then: containers use the docker network, laptops use the Tailscale name.
- [ ] **Old n8n volumes cleanup.** `erp-server_n8n_data`, `erp-server_n8n_postgres_data`, `erp-server_pgadmin_data` still on disk; delete after confirming nothing local is needed (n8n is cloud now).

## Done

- [x] 2026-06-10 — Claude Code project setup: CLAUDE.md project context, 4 subagents, 4 slash commands, permissions in `.claude/settings.json`, tasks/ files, launch.json fix, `.DS_Store` gitignore entry.
- [x] 2026-06-10 — Compose hardening for the shared Mac mini stack (see Current Focus checked items). Resolved former backlog items: volume-path decision (postgres 18 pinned + constraint comment in compose), dead n8n basic-auth removed, obsolete `version:` key removed, `.env.example` created.

## Review

**2026-06-10 — Shared-infra compose hardening.** `erp-server/docker-compose.yml` rewritten for the Mac mini hosting model (Tailscale hostname `mac-mini-ca-mac.tailc3d837.ts.net` as canonical `HOST_NAME`); `.env.example`, `docs/team-hosting.md`, `synchronize: false`, and `.claude` doc sync. Verified: `docker compose config` renders cleanly with a throwaway env file and fails fast with each `${VAR:?}` message without one; `npm run build` passes after the app.module.ts change. Stack `up` deliberately NOT re-run locally (existing local n8n volume holds the old encryption key; see docs §11). Cutover on the mini is a human step.
