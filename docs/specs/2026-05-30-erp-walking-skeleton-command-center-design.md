# Evertrust ERP — Sub-project #1: Walking Skeleton + Command Center

**Design spec** · 2026-05-30 · Status: approved-for-planning

---

## 1. Context & purpose

The Evertrust ERP is the **system-of-record + API + observability/approval control-plane** over the n8n "Arsenal" automations. It exists to retire "spreadsheet-as-truth" and enforce the operating doctrine:

- Postgres = operational memory.
- All operational writes flow `Workflow → API → Validation → DB → Audit log`.
- Observability first; every failure observable; human approval gates on irreversible actions.

A full ERP decomposes into ~7 subsystems: **platform skeleton**, Command Center, Approvals & Escalations, Leads & Campaign CRM, Tender Pipeline, Suppliers/Customers, Reporting/KPI. The **skeleton is a prerequisite for all of them**.

This sub-project is the **walking skeleton** (the full stack, end-to-end) plus the **Command Center** (read-only observability) as its first thin vertical slice. It deliberately touches **none** of the live Google Sheets that revenue workflows depend on.

## 2. Goals & success criteria

- Stand up DB + API + auth + client + audit, deployed to **TEST then PROD**.
- Command Center v1 shows **Run health** (per Arsenal workflow: last run, status, retries, duration, failure reason) + **Escalations** (what failed / needs a human, with an *acknowledge* action).
- Prove the `Workflow → API → DB → Audit` ingest path on low-stakes telemetry (escalation push) — the pattern every later module reuses.
- **Done =** an operator opens the ERP, authenticates, and sees live Arsenal run health + escalations without logging into n8n; every mutation is audited; the sync worker is itself observable.

## 3. Scope

### In scope (v1)
- Monorepo (`client` / `server` / `shared`), TypeScript end-to-end.
- Supabase Postgres + Supabase Auth (team; `admin`/`member` roles).
- Fastify API: health; runs (list/detail); escalations (list/ack); ingest (escalation push); audit-on-write; env-validated config; structured logging; central error handler.
- n8n **sync worker** (pull executions/workflows → `workflow_runs`; self-observable via `sync_state`; bounded backoff; self-escalation on repeated failure).
- **Derived escalations** from failed executions (so the panel is useful *before* the n8n push edit ships).
- One HTTP node added to the n8n shared error-handler to push escalations to `/api/ingest/escalation`.
- Next.js (App Router) frontend: magic-link login, Command Center (run-health table + escalations panel + ack), app shell.
- TEST + PROD environments.
- Intent-level tests + read-only verification against the real n8n API.

### Out of scope (named later slices)
Deadlines-at-risk; per-workflow drilldown UI; domain modules (Leads/Tenders/Suppliers/Customers); reporting/KPI; full RBAC; websockets/realtime; pushing *run* (not just escalation) events from workflows.

## 4. Architecture

Separate **Fastify REST API** (system-of-record, consumed by **both** n8n and the browser) + **Next.js frontend**. Supabase = Postgres + Auth. Railway hosts the Fastify service (+ sync worker); Vercel or Railway hosts Next.js.

**Why separate, not Next.js full-stack:** the sync worker is a long-running, always-on poller and the ingest endpoint must be always-on — both fit a persistent Node service, not serverless. API-first keeps n8n a first-class consumer. **Shared Zod schemas in `shared/` are the single contract** for client + server, so they cannot drift.

```
evertrust-ERP/
├─ client/   Next.js (App Router) + TS + shadcn + Tailwind + TanStack Query + @supabase/ssr
├─ server/   Fastify + TS + Drizzle + Zod + pino  (API + sync worker)
├─ shared/   Zod schemas + inferred TS types (DTOs)
└─ docs/superpowers/specs/
```

## 5. Components (each a single purpose)

**server/**
- `db/` — Drizzle schema + migrations + client.
- `auth/` — verify Supabase JWT, attach `{uid, role}` to the request.
- `sync/` — n8n pull worker (scheduled; upserts run health; records own status in `sync_state`).
- `routes/` — `GET /health`, `GET /api/runs`, `GET /api/runs/:id`, `GET /api/escalations`, `POST /api/escalations/:id/ack` (write), `POST /api/ingest/escalation` (n8n push, API-key auth).
- `audit/` — middleware: every mutation writes an `audit_log` row.
- `lib/` — Zod-validated env config, n8n API client, error shapes, request-id.

**shared/** — Zod schemas + inferred types: `RunDTO`, `EscalationDTO`, `IngestEscalation`, `AckRequest`, error envelope.

**client/** — `Login` (Supabase magic-link), `CommandCenter` (run-health table + escalations panel w/ ack), app shell, typed API client, Supabase SSR auth + middleware guard.

## 6. Data model (Postgres / Drizzle)

- **`workflow_runs`** — `id`, `n8n_execution_id` (unique), `workflow_id`, `workflow_name`, `status` (`success|error|running|waiting`), `started_at`, `finished_at`, `duration_ms`, `error_message?`, `mode`, `raw` (jsonb), `synced_at`.
- **`escalations`** — `id`, `source` (`push|derived`), `workflow_id`, `workflow_name`, `execution_id?`, `severity`, `title`, `detail` (jsonb), `status` (`open|acknowledged|resolved`), `created_at`, `acknowledged_by?`, `acknowledged_at?`.
- **`audit_log`** — `id`, `actor_user_id?`, `actor_type` (`user|system|n8n`), `action`, `entity_type`, `entity_id`, `summary`, `before` (jsonb), `after` (jsonb), `request_id`, `created_at`.
- **`users`** — `id` (= Supabase auth uid), `email`, `role` (`admin|member`), `created_at`. Created/synced on first login.
- **`sync_state`** — `id`, `key`, `last_synced_at`, `last_status`, `last_error?`, `consecutive_failures`. Makes the monitor itself observable.

## 7. Data flow

- **Run health (pull):** n8n API → sync worker (~60s) → upsert `workflow_runs` → `GET /api/runs` → client polls (TanStack Query ~20s) → table.
- **Escalations:** n8n shared error-handler → one HTTP node → `POST /api/ingest/escalation` → Zod-validate → insert (`source=push`) + audit (`actor_type=n8n`). **Plus** derived fallback: when the sync sees an `error` execution with no escalation, it opens one (`source=derived`, `actor_type=system`) — panel is useful before the n8n edit.
- **Ack (write):** client → `POST /api/escalations/:id/ack` (member+) → state change + audit (`actor=user`) → refetch.
- **Auth:** Supabase magic-link → JWT (cookie via `@supabase/ssr`) → Bearer to Fastify → verify → load/create `users` row → per-route authz.

## 8. Auth & authorization

- Supabase Auth magic-link. Browser holds the session (cookie via `@supabase/ssr`) and sends the access token as `Bearer` to Fastify. Fastify verifies the Supabase JWT, loads/creates the `users` row, attaches `{uid, role}`.
- Roles: `admin`, `member`. v1 enforcement: any authenticated user can **view**; **ack** requires an authenticated user (member+); `admin` reserved for later destructive/approval actions. Audit always records the actor.
- The **ingest** endpoint is authenticated by a **separate static API key** (n8n → ERP), never a user JWT.

## 9. Error handling & observability (doctrine-critical)

- Central Fastify error handler → `pino` structured log + consistent `{ error, code, requestId }`. Request-id correlation on every call.
- Sync worker: **bounded exponential backoff** (never infinite); **self-escalates after N consecutive failures** (the monitor monitors itself, surfaced via `sync_state`).
- Ingest rejects bad payloads loudly (400 + log, never silent-drop) — fail loud.
- Env validated at boot via Zod; missing config crashes loud.
- Every mutation → `audit_log` (recoverable/reviewable/replayable).

## 10. n8n integration

- **Pull:** ERP sync worker calls the n8n Cloud public REST API (`GET /api/v1/executions`, `/api/v1/workflows`) with a per-environment API key. Upsert by `n8n_execution_id` → idempotent.
- **Push:** the n8n shared error-handler gets one HTTP Request node → `POST /api/ingest/escalation` with `{ workflowId, workflowName, executionId, severity, title, detail }`, API-key auth. Minimal, centralized, additive — placed **alongside** the existing WhatsApp error alert, which is left untouched.
- **Assumption to confirm at setup:** the n8n public API (`api/v1`) is enabled for the Cloud instance and an API key can be issued. (The connected n8n MCP confirms execution data is accessible; the ERP *runtime* path needs the public API + key.)

## 11. Environments

TEST + PROD only (no DEV/STAGING). Two Supabase projects (TEST + PROD, clean isolation) + two Railway envs (+ two Vercel envs if used). n8n pushes to the env-correct ingest URL and pulls per-env credentials. Secrets via env vars, never committed; `.env.example` documents every var.

## 12. Testing & verification

- **vitest (intent-level):** audit row written on every mutation; JWT guard rejects missing/invalid tokens; ingest rejects bad payloads; sync upsert is **idempotent** (same `n8n_execution_id` twice = one row); ack transitions state + writes audit.
- **Integration:** runs/escalations endpoints against a test Postgres.
- **Client:** smoke test — Command Center renders runs + escalations from a mocked API.
- **Verification (per repo CLAUDE.md — prove it works):** run the **read-only** sync against the real n8n API and show `workflow_runs` populating; POST a test payload to `/api/ingest/escalation` and show the escalation appear + an `audit_log` row.

## 13. Dependencies & open setup items

- Supabase project(s) + keys (URL, anon key, service-role key, JWT secret).
- Railway account + service(s); Vercel account if hosting Next.js there.
- n8n API key + base URL (TEST/PROD); ERP ingest URL configured into the n8n error-handler.
- Node LTS 20+; package manager (pnpm vs npm workspaces — decided in the implementation plan).
- Local dev DB: a free Supabase project (or local Postgres) — **non-blocking**, coding can start immediately.

## 14. Risks & mitigations

- **n8n Cloud API limits/availability** → bounded backoff + `sync_state` observability + self-escalation.
- **Touching the live error-handler** → a single additive HTTP node next to the existing alert; test in a TEST workflow first; the WhatsApp alert is untouched.
- **Two-runtime ops overhead** → accepted; justified by the always-on sync worker + ingest.
- **Supabase JWT verification specifics** (JWKS vs shared secret) → confirm during implementation.
