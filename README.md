# EverTrust ERP & Marketing

The internal ERP and growth-marketing platform of EverTrust GmbH — tender management for
German public procurement (Vergabe) plus the outbound "Growth Engine" (campaigns, leads,
meetings, performance), automated through n8n cloud and local AI models.

Self-hosted on the company Mac mini (24/7, Docker, team access via Tailscale). Migrated from
the archived [`Ryugwki/evertrust-ERP`](https://github.com/Ryugwki/evertrust-ERP) repo on
2026-06-11; previous Render/Vercel hosting is retired.

## What's inside

pnpm + Turborepo monorepo:

| Path | Package | What it is |
|---|---|---|
| [`erp-server/`](erp-server) | `@evertrust/api` | NestJS 11 API — 22 modules: tenders (7-state machine), pricing engine, approvals/QC gates, campaigns + arsenal triggers, leads, meetings, performance (PMS), JWT + argon2 auth, L1–L5 RBAC, immutable audit log |
| [`erp-client/`](erp-client) | `@evertrust/web` | Next.js 15 App Router frontend — React 19, Tailwind v4, shadcn/ui, React Query (design standard: [`erp-client/DESIGN.md`](erp-client/DESIGN.md)) |
| [`packages/db/`](packages/db) | `@evertrust/db` | Drizzle ORM schema (32 tables, pgvector), migrations + idempotent seed |
| [`packages/shared/`](packages/shared) | `@evertrust/shared` | Zod DTOs and pure domain logic shared by api + web (state machine, permissions matrix, pricing/deadline computations) |
| [`ai-stack/`](ai-stack) | — | AI gateway on the mini: LiteLLM (OpenAI-compatible, routes to Ollama backends) + Redis cache + Qdrant vector DB + SearXNG web search |
| [`docs/`](docs) | — | [`team-hosting.md`](docs/team-hosting.md) (hosting/runbook — **read this first for infra**), [`evertrust/`](docs/evertrust) (company onboarding pack 01–08, canonical 52-row workflow), design specs |

Automation lives in **n8n cloud** (`evertrustgmbh.app.n8n.cloud`); the ERP fires its webhooks
and n8n reaches back through the mini's public Funnel path. LLM calls route through the
LiteLLM gateway to local Ollama models (MacBook Pro primary, mini fallback).

## Getting started (development)

Prereqs: Node 24 (`.nvmrc`), pnpm 11 via corepack, Docker, and Tailscale (to reach the team
database on the mini).

```bash
corepack enable                       # makes the pinned pnpm available
pnpm install
pnpm run build                        # turbo: all packages
pnpm run test                         # API jest suite (35 suites / 299 tests)
pnpm run lint && pnpm run typecheck
```

Environment: copy `erp-server/.env.example` → `erp-server/.env` and fill it (values live in
the team vault — **never commit `.env` files**). For laptop dev use your own database
`erp_<yourname>` on the mini, never the production `evertrust` DB — see
[docs/team-hosting.md](docs/team-hosting.md) §1/§5.

Run the apps locally:

```bash
corepack pnpm --filter @evertrust/api start:dev   # API on :3001 (needs DATABASE_URL)
corepack pnpm --filter @evertrust/web dev         # web on :3000
```

Database migrations (note: `DATABASE_URL` must be in your shell environment):

```bash
corepack pnpm --filter @evertrust/db db:generate   # after schema edits
DATABASE_URL='postgresql://…' corepack pnpm --filter @evertrust/db db:migrate
```

## Production (Mac mini)

```bash
cd erp-server && docker compose up -d --build   # postgres (pgvector) + erp-api + erp-web
cd ../ai-stack && docker compose up -d          # AI gateway stack (joins the same network)
```

- Team access: `http://mac-mini-ca-mac.tailc3d837.ts.net:3000` (tailnet only)
- The api container migrates + seeds idempotently on every start (`erp-server/api-start.sh`);
  the dev seed is gated off in production
- Public surfaces are Tailscale Funnel mounts only (gateway `/`, ERP callbacks `/erp`,
  Qdrant `:8443`, SearXNG `:10000`) — all auth-enforced
- Nightly backups (Postgres + Qdrant + uploads) per [docs/team-hosting.md](docs/team-hosting.md) §8

## Working in this repo

- CI runs `lint`, `typecheck`, `test`, `build` on every push/PR (`.github/workflows/ci.yml`)
- `CLAUDE.md` carries the AI-assistant project context; `AGENTS.md` the engineering rules;
  `tasks/todo.md` is the living plan and `tasks/lessons.md` the gotcha log
- Roadmap reference: [docs/evertrust/08-workflow-canonical.md](docs/evertrust/08-workflow-canonical.md)
  (8 phases / 52 rows — phases 4–6 and most of 7 are built; Argus/Scribe intake and Sieve
  shortlisting are next)
