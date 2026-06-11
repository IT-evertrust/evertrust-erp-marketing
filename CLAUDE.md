# EverTrust ERP & Marketing

pnpm + Turborepo monorepo for the EverTrust ERP and marketing platform (migrated from the
archived `Ryugwki/evertrust-ERP` repo on 2026-06-11; hosting moved from Render/Vercel to the
Mac mini):
- `erp-server/` — `@evertrust/api`: NestJS 11 backend (22 modules — 17 feature + infra, JWT +
  argon2 auth, L1–L5 RBAC, audit log, Drizzle ORM)
- `erp-client/` — `@evertrust/web`: Next.js 15 App Router frontend (React 19, Tailwind v4,
  shadcn/ui, React Query; design standard in `erp-client/DESIGN.md`)
- `packages/db/` — `@evertrust/db`: Drizzle schema (32 tables), migrations in `drizzle/`
  (0000–0018 + `meta/` journal), idempotent seed
- `packages/shared/` — `@evertrust/shared`: Zod DTOs, the 7-state tender STATE_MACHINE,
  ROLE_PERMISSIONS, pricing engine pure functions — single source of truth shared by api + web
- `ai-stack/` — the AI gateway on the Mac mini: LiteLLM (4000 loopback, funneled :443) +
  Redis + Qdrant (6333 loopback, funneled :8443) + SearXNG (auth proxy funneled :10000).
  Routes n8n-cloud LLM calls to Ollama backends. Config: `ai-stack/config/litellm-config.yaml`.
- `docs/` — `team-hosting.md` (Mac mini hosting model — REQUIRED READING for infra work),
  `evertrust/` (canonical company/workflow spec, 52-row roadmap), `specs/`
- `.claude/` — settings, skills, project subagents (`agents/`) and slash commands (`commands/`)
- `tasks/` — todo.md and lessons.md per the workflow rules below

## Commands

All from the repo root. pnpm is pinned via `packageManager` (corepack); if `pnpm` is not on
PATH, prefix with `corepack` (e.g. `corepack pnpm install`).

```bash
pnpm install                                  # whole workspace
pnpm run build / lint / typecheck / test      # turbo across all packages
corepack pnpm --filter @evertrust/api test    # API jest suite only (35 suites / 299 tests)
corepack pnpm --filter @evertrust/api start:dev   # API watch mode (needs DATABASE_URL)
corepack pnpm --filter @evertrust/web dev     # web dev server on :3000
corepack pnpm --filter @evertrust/db db:generate  # drizzle-kit generate (after schema edits)
corepack pnpm --filter @evertrust/db db:migrate   # apply migrations (target = DATABASE_URL)
corepack pnpm --filter @evertrust/db db:seed      # idempotent bootstrap seed
```

The db scripts read `DATABASE_URL` from the SHELL environment (dotenv only loads
`packages/db/.env`, which doesn't exist) — prefix the command:
`DATABASE_URL='postgresql://…' corepack pnpm --filter @evertrust/db db:migrate`.

Docker (the production stack on the Mac mini):

```bash
cd erp-server && docker compose up -d   # postgres (pgvector) + erp-api + erp-web; REQUIRES .env
cd ai-stack && docker compose up -d     # LiteLLM gateway + Redis + Qdrant + SearXNG; REQUIRES ai-stack/.env
                                        # (erp-server stack must be up first — it owns the shared network)
```

Both compose files fail fast on missing required env vars (`${VAR:?}` syntax). The erp-api
container runs idempotent migrate + seed on every start (`erp-server/api-start.sh`).

## Services & Ports

| Service | Port | Notes |
|---|---|---|
| erp-web (Next.js, Docker) | 3000 | Team access: `http://mac-mini-ca-mac.tailc3d837.ts.net:3000` |
| erp-api (NestJS, Docker) | 3001 | `GET /health` is public; n8n-cloud callbacks via Funnel path `/erp` on :443 |
| postgres (erp-postgres, Docker) | 5432 | `pgvector/pgvector:pg18`. Holds `evertrust` (prod), `litellm`, per-dev `erp_<name>` DBs. **TRAP: a native Homebrew postgresql@18 also listens on loopback 5432 on the mini** — use the docker network (`erp-postgres:5432`) from containers, the Tailscale name from laptops |
| LiteLLM gateway (ai-litellm) | 4000 (127.0.0.1) | Public via Tailscale Funnel :443; OpenAI-compatible `/v1` |
| Qdrant (ai-qdrant) | 6333 (127.0.0.1) | Public via Funnel :8443; API-key required |
| SearXNG (ai-searxng-auth) | 8088 (127.0.0.1) | Public via Funnel :10000; X-Search-Key header required |
| Redis (ai-redis) | — | compose-network internal only (gateway cache) |
| n8n | — | n8n CLOUD (evertrustgmbh.app.n8n.cloud); local n8n retired, old volumes kept |

## Environment

- `erp-server/.env` (gitignored; template `.env.example`) feeds BOTH the compose interpolation
  (`DB_*`, `NEXT_PUBLIC_API_URL`) and the API's boot-time Zod env contract — the authoritative
  list of API vars with docs is `erp-server/src/config/env.schema.ts`. Team values in the vault.
- `erp-client/.env.example` → `.env.local` for laptop dev (`NEXT_PUBLIC_API_URL`). In Docker
  the value is a BUILD ARG inlined into the bundle — changing it needs an image rebuild.
- `AUTH_DISABLED=true` turns off login and impersonates a super-admin — dev/demo only, never
  on the mini.
- `LITELLM_SALT_KEY` can never change after first boot; the n8n virtual key lives in
  `~/.evertrust/n8n-virtual-key.json` on the mini + the vault.
- Never commit .env files or put secret values in code, docs, or compose defaults.

## Custom Agents & Commands

Subagents in `.claude/agents/`:
- `nestjs-backend` — NestJS work in erp-server (modules, controllers, services, DI wiring)
- `nextjs-frontend` — Next.js / React 19 / Tailwind v4 / shadcn work in erp-client
- `drizzle-database` — Drizzle schema, migrations, seed, and the Postgres service
- `code-reviewer` — reviews diffs for bugs, security, and simplicity before completion

Slash commands in `.claude/commands/`:
- `/dev-up` — start the Docker ERP stack (pass "dev" for watch-mode dev servers)
- `/db-migrate` — drizzle-kit generate + migrate workflow
- `/checkpoint` — record progress in `tasks/todo.md`
- `/lesson` — capture a correction in `tasks/lessons.md`

## Known Issues & Gotchas

- Loopback 5432 shadowing on the mini: Homebrew postgresql@18 owns `localhost:5432` locally —
  a process IS actively using it, so don't stop it casually; consolidation is a backlog item.
- Postgres volume mounts at `/var/lib/postgresql` (no `/data`) — correct ONLY for postgres 18+
  images. The pre-migration alpine volume `erp-server_postgres_data` is kept on disk until the
  pgvector swap is verified; the live volume is `erp-server_postgres_data_pg18`.
- drizzle-kit cannot do enum value renames/removals incrementally — squash in dev only; never
  squash migrations already applied to the shared DB. `CREATE EXTENSION vector` was hand-added
  to migration 0000 and must survive any regeneration.
- The web image bakes `NEXT_PUBLIC_API_URL` at build time; the api runs under the tsx loader
  because `@evertrust/db`/`@evertrust/shared` ship raw TS (intentional, do not "fix").
- Tender roadmap state: Phases 4–6 + most of 7 DONE; Phase 2 (Argus/Scribe intake), Phase 3
  (Sieve shortlist), Phase 7 R32–R33 (TYPE 2 completeness) and Phase 8 are NOT built — see
  `docs/evertrust/08-workflow-canonical.md`.
- The client has no tests; API tests live in `erp-server/test/` (jest).

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, stop and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-Level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
