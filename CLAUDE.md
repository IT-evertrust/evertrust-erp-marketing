# EverTrust ERP & Marketing

Monorepo for the EverTrust ERP and marketing platform (two independent npm packages, no workspace root):
- `erp-client/` — Next.js 16 frontend (App Router, React 19 + React Compiler, Tailwind v4 CSS-first)
- `erp-server/` — NestJS 11 backend with Prisma + PostgreSQL; infra (Postgres, pgAdmin, n8n automation) runs via Docker Compose

## Architecture

- `erp-client/src/app/` — Next.js App Router (layout.tsx, page.tsx, globals.css; still create-next-app boilerplate). Path alias `@/*` → `./src/*`. Tailwind v4 is configured in globals.css via `@theme inline` — there is NO tailwind.config.* and none should be added.
- `erp-server/src/` — NestJS source: main.ts (port 3000 hardcoded), app.module.ts, app.controller.ts + app.service.ts (single `GET /` → "Hello World!"), prisma.service.ts (exists but not registered in any module yet).
- `erp-server/prisma/schema.prisma` — Prisma schema (example User/Post models only; no migrations directory yet).
- `erp-server/docker-compose.yml` — ERP Postgres only (local n8n/pgAdmin retired 2026-06-10; n8n runs on n8n CLOUD). Runs 24/7 on the Mac mini — see `docs/team-hosting.md`.
- `ai-stack/` — the "Hermes req" AI gateway on the Mac mini: LiteLLM (OpenAI-compatible, port 4000 loopback, funneled at 443) + Redis cache + Qdrant vector DB (6333 loopback, funneled at 8443). Routes n8n-cloud LLM calls to Ollama backends (Trev's machine primary, mini fallback). Config: `ai-stack/config/litellm-config.yaml`.
- `.claude/` — settings, skills, project subagents (`agents/`) and slash commands (`commands/`).
- `tasks/` — todo.md and lessons.md per the workflow rules below.

## Commands

Server (run from `erp-server/`):

```bash
cd erp-server
npm run start:dev        # NestJS watch mode (needs Postgres on 5432 up, or startup crashes)
npm run build            # nest build -> dist/
npm run prisma:generate  # generate Prisma client (works)
npm run prisma:migrate   # prisma migrate dev — currently BROKEN, see Known Issues
npm run prisma:studio    # prisma studio — currently BROKEN, see Known Issues
```

The server has NO test script (`npm test` exits 1 by design) and no lint/format scripts — do not invent them.

Client (run from `erp-client/`):

```bash
cd erp-client
npm run dev    # next dev (port 3000 by default)
npm run build  # next build
npm run lint   # bare eslint — must be run from inside erp-client/
```

Docker (run from `erp-server/`, like the npm scripts):

```bash
cd erp-server && docker compose up -d   # ERP postgres; REQUIRES .env (see .env.example)
cd ai-stack && docker compose up -d     # LiteLLM gateway + Redis + Qdrant; REQUIRES ai-stack/.env
                                        # (erp-server stack must be up first — shared network)
docker compose ps / logs                # status / debug, from the respective directory
```

Both compose files fail fast on missing required env vars (`${VAR:?}` syntax).

## Services & Ports

| Service | Port | Notes |
|---|---|---|
| erp-server (NestJS) | 3000 | Hardcoded in `erp-server/src/main.ts`; PORT env var is not read |
| erp-client (next dev) | 3000 | CONFLICT with server — `next dev` auto-bumps to 3001 if the server already holds 3000 |
| postgres (erp-postgres, Docker) | 5432 | ERP database. **TRAP: on the Mac mini a native Homebrew postgresql@18 also listens on loopback 5432** — `localhost:5432` ON the mini hits the brew instance, not the container; containers via `host.docker.internal` hit brew too. Use the docker network (`erp-postgres:5432`) from containers, the Tailscale name from laptops |
| LiteLLM gateway (ai-litellm) | 4000 (127.0.0.1) | Public via Tailscale Funnel :443 once enabled; OpenAI-compatible `/v1` |
| Qdrant (ai-qdrant) | 6333 (127.0.0.1) | Public via Funnel :8443; API-key required |
| Redis (ai-redis) | — | compose-network internal only (gateway cache) |
| n8n | — | n8n CLOUD (evertrustgmbh.app.n8n.cloud); local n8n retired, old volumes kept |

## Environment

- Committed templates: `erp-server/.env.example` (DB + app vars) and `ai-stack/.env.example` (gateway keys, Qdrant key, Trev's Ollama address). Copy to `.env` (gitignored) and fill in; team values live in the vault. `erp-client` has no .env files.
- The server code reads `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `LOG_LEVEL` via @nestjs/config. `CORS_ORIGIN` exists as a var name but is not read by any code yet.
- Prisma's datasource url is NOT configured: `schema.prisma` has no `url` field and there is no `prisma.config.ts` (required by Prisma 7), so migrate/studio commands fail.
- `LITELLM_SALT_KEY` can never change after first boot (encrypts gateway DB credentials); the n8n virtual key for the gateway lives in `~/.evertrust/n8n-virtual-key.json` on the mini + the vault.
- Never commit .env files or put secret values in code, docs, or compose defaults.

## Custom Agents & Commands

Subagents in `.claude/agents/`:
- `nestjs-backend` — NestJS work in erp-server (modules, controllers, services, DI wiring)
- `nextjs-frontend` — Next.js 16 / React 19 / Tailwind v4 work in erp-client
- `prisma-database` — Prisma schema, client generation, and migration work
- `code-reviewer` — reviews diffs for bugs, security, and simplicity before completion

Slash commands in `.claude/commands/`:
- `/dev-up` — bring up Docker services and the dev servers in the right order
- `/db-migrate` — run the Prisma generate + migrate workflow
- `/checkpoint` — record progress in `tasks/todo.md`
- `/lesson` — capture a correction in `tasks/lessons.md`

## Known Issues

- Dual ORM: both `typeorm` and `@prisma/client` are in erp-server deps. Prisma is the intended ORM (per commit history), but `app.module.ts` currently wires `TypeOrmModule.forRoot` (with `synchronize: false` — must stay false, the DB is shared) while `PrismaService` is unregistered dead code. Use Prisma for new work; TypeORM is slated for removal.
- Prisma datasource url missing: no `prisma.config.ts` and no `url` in schema.prisma, so `prisma:migrate`, `prisma:migrate:deploy`, and `prisma:studio` all fail (Prisma 7 does not auto-load .env). `prisma:generate` works.
- Port collision: server hardcodes 3000 and `next dev` defaults to 3000; next auto-bumps to 3001 when the server runs — keep any client API URL in sync.
- Loopback 5432 shadowing on the mini: Homebrew postgresql@18 owns `localhost:5432` locally (see Services table) — a process IS actively using it, so don't stop it casually; consolidation is a backlog item.
- Postgres data persistence: the volume mounts at `/var/lib/postgresql` (no `/data`) — correct ONLY for postgres:18+ images.
- No test framework on the server (`npm test` exits 1); the client has no tests either.
- Server startup connects eagerly to Postgres — `npm run start:dev` crashes if no Postgres is reachable.
- Tailscale Funnel not yet enabled on the tailnet (admin-console toggle) — until then n8n cloud cannot reach the gateway.

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
