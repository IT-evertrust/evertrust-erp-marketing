# tasks/todo.md

Working plan for this repo, per CLAUDE.md Task Management:

1. Write the plan here as checkable items **before** implementing.
2. Check in on the plan before starting non-trivial work.
3. Mark items complete (`[x]`) as you go; move finished items to **Done**.
4. Add a summary of what changed and how it was verified to **Review** when a chunk of work lands.

Backlog items below are seeded only from verified defects in the current codebase.

---

## Current Focus

**Shared infra stack on the Mac mini** (plan approved 2026-06-10; repo side implemented, cutover pending):

- [x] Harden `erp-server/docker-compose.yml`: restart policies, required secrets (`${VAR:?}`), pinned images (`n8nio/n8n:2.25.6`, `dpage/pgadmin4:9.15`), `HOST_NAME`-driven n8n URLs, `N8N_SECURE_COOKIE=false`, n8n healthcheck, loopback-only n8n-postgres, pgAdmin behind `--profile tools`, dead `N8N_BASIC_AUTH_*` block and obsolete `version:` key removed.
- [x] `erp-server/.env.example` committed template (names + placeholders only).
- [x] `app.module.ts`: TypeORM `synchronize: false` (shared DB safety).
- [x] `docs/team-hosting.md` runbook (Tailscale access, mini checklist, deploy flow, per-dev DBs, n8n rules, backups, recovery).
- [ ] **Cutover on the Mac mini** (human steps, follow docs/team-hosting.md): mini checklist §3, clone repo, create `.env` with fresh secrets (vault), `docker compose up -d`, n8n owner setup, create per-dev databases, laptops switch `DB_HOST` to `mac-mini-ca-mac.tailc3d837.ts.net`.
- [ ] Set up the nightly backup job on the mini (docs §8) once an external SSD is attached.
- [ ] Commit the repo-side changes (compose, .env.example, app.module.ts, docs, .claude updates, tasks/) — nothing is staged yet; keep the root `.gitignore` fix as its own commit.

## Backlog

- [ ] **Fix Prisma config (migrations are broken).** `npm run prisma:migrate`, `prisma:migrate:deploy`, and `prisma:studio` in `erp-server` all fail with "The datasource.url property is required in your Prisma config file". Prisma 7 moved the datasource URL out of `schema.prisma` into a `prisma.config.ts`, which does not exist, and the Prisma 7 CLI no longer auto-loads `.env`. Create `/Users/macco/Documents/evertrust-erp-marketing/erp-server/prisma.config.ts` that loads env (dotenv is already a dependency) and supplies the datasource url from `DATABASE_URL` (already named in `erp-server/.env`). Verify with `npm run prisma:migrate`.
- [ ] **Pick ONE ORM.** Both stacks are installed: TypeORM (`typeorm@1.0.0` + `@nestjs/typeorm` + `pg`) is what's actually wired via `TypeOrmModule.forRoot` in `erp-server/src/app.module.ts` (now with `synchronize: false` and zero entity files), while `src/prisma.service.ts` is dead code — never registered in any module. Either: go Prisma (register `PrismaService` as a provider, remove `typeorm`/`@nestjs/typeorm`/`pg` and the TypeORM config, including the hardcoded DB password fallback in `app.module.ts`), or go TypeORM (delete `prisma.service.ts`, `prisma/`, `@prisma/client`, `prisma`, and the `prisma:*` scripts). Don't build features until this is decided.
- [ ] **Resolve the client/server port collision.** `erp-server/src/main.ts` hardcodes `app.listen(3000)` and `erp-client`'s `npm run dev` also defaults to port 3000. Make the server read a `PORT` env var with default 3001 (it currently reads no port env at all), and align `NEXT_PUBLIC_API_URL` in `erp-server/.env` with the new port.
- [ ] **TLS for the n8n editor** (`tailscale serve`): would let us remove `N8N_SECURE_COOKIE: "false"` from the compose file and set `N8N_PROTOCOL: https` (see docs/team-hosting.md §9).
- [ ] **Add a real test setup to `erp-server`.** `npm test` is a failing stub (`echo "Error: no test specified" && exit 1`); there is no jest config, no `*.spec.ts`, no `test/` dir. Add jest + `@nestjs/testing`, a first spec for `app.controller.ts`, and replace the `test` script.
- [ ] **Commit the root `.gitignore` `.DS_Store` fix.** Uncommitted edit appending a macOS block (`.DS_Store` + `**/.DS_Store`). Commit it as its own commit; never commit the `.DS_Store` file itself.

## Done

- [x] 2026-06-10 — Claude Code project setup: CLAUDE.md project context, 4 subagents, 4 slash commands, permissions in `.claude/settings.json`, tasks/ files, launch.json fix, `.DS_Store` gitignore entry.
- [x] 2026-06-10 — Compose hardening for the shared Mac mini stack (see Current Focus checked items). Resolved former backlog items: volume-path decision (postgres 18 pinned + constraint comment in compose), dead n8n basic-auth removed, obsolete `version:` key removed, `.env.example` created.

## Review

**2026-06-10 — Shared-infra compose hardening.** `erp-server/docker-compose.yml` rewritten for the Mac mini hosting model (Tailscale hostname `mac-mini-ca-mac.tailc3d837.ts.net` as canonical `HOST_NAME`); `.env.example`, `docs/team-hosting.md`, `synchronize: false`, and `.claude` doc sync. Verified: `docker compose config` renders cleanly with a throwaway env file and fails fast with each `${VAR:?}` message without one; `npm run build` passes after the app.module.ts change. Stack `up` deliberately NOT re-run locally (existing local n8n volume holds the old encryption key; see docs §11). Cutover on the mini is a human step.
