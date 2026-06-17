# Configuration & credentials map

The one place that answers "where does this credential live, who reads it, and why?"
This is a polyglot monorepo: three runtimes (NestJS, Next.js, Python) each load config
their own way, so config necessarily lives in a few homes. This file documents all of them.

## TL;DR — the mental model

The repo has three peer parts: `erp-client` (frontend), `erp-server` (API), and
`erp-agents` (the 9 agent services — a separate backend, not nested under the ERP).

```
erp-client/.env.local   →  Next.js frontend     (public, NEXT_PUBLIC_* only)
erp-server/.env         →  NestJS API           (owns the DB + all server secrets)
erp-agents/.env         →  9 Python agents      (LLM/email/search keys; NO db url)
ai-stack/.env           →  self-hosted AI infra (LiteLLM / Qdrant / SearXNG)
erp-agents/workflows/<agent>/tokens/*.json  →  Google OAuth tokens (files, not env)
```

`erp-agents/` layout: `workflows/` (the 9 runnable packages), `blueprints/` (specs),
`plans/` (planning docs), `scripts/` (dev-only DB seed/clean), `mock-ui/` (static
control panel for running agents locally).

Rules of thumb:
- The **database belongs to the ERP**. Only `erp-server/.env` has `DATABASE_URL`. The
  agents never connect to Postgres — they go through the ERP machine API.
- There is exactly **one shared secret** across the ERP↔agents boundary (the arsenal
  token). Same value, two names, two files — see below. That is structural, not duplication.
- **Secrets are never committed.** Only `.env.example` files are tracked. The real
  `.env` / `.env.local` are git-ignored.

---

## 1. `erp-client/.env.local` — frontend (Next.js, port 3000)

Build-time, public config. Everything here is `NEXT_PUBLIC_*`, meaning it is **inlined
into the browser bundle** — never put a real secret here.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Origin of the ERP API the browser calls (`http://localhost:3001` for local dev). |
| `NEXT_PUBLIC_AUTH_DISABLED` | `true` → skip the `/login` gate so every page renders with no session. Must pair with the API's `AUTH_DISABLED`. |

Template: `erp-client/.env.example`.

## 2. `erp-server/.env` — backend API (NestJS, port 3001)

The source of truth. Owns the database connection and all server-side secrets.
Validated at boot by `src/config/env.schema.ts` (zod).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **The only DB credential in the repo.** Neon Postgres connection string. |
| `JWT_SECRET` | Signs/verifies session JWTs. |
| `ARSENAL_INGEST_TOKEN` | Shared secret for the machine API. **Must equal the agents' `ARSENAL_TOKEN`.** |
| `AGENT_<STAGE>_URL` | Where the ERP dispatches each agent (e.g. `AGENT_REACH_BAZOOKA_URL=http://localhost:8800`). Unset → falls back to the n8n webhook. |
| `AUTH_DISABLED` / `AUTH_DISABLED_USER_EMAIL` | Local demo mode: serve a super-admin for token-less requests. Pairs with the client flag. |
| `CORS_ORIGINS` | Allowed browser origins (the client runs cross-origin on :3000). |
| `COOKIE_SECURE` | Whether the auth cookie is HTTPS-only (false for local http). |
| `NODE_ENV`, `PORT` | Standard runtime. |

Template: `erp-server/.env.example`.

## 3. `erp-agents/.env` — the 9 Python agents

**One real file, symlinked into every package** (`workflows/bazooka/.env`,
`workflows/glock/.env`, … all point to `../../.env`). Editing this updates all agents at
once. Holds agent-runtime config only — **no `DATABASE_URL`** (the agents don't touch
Postgres; they use the ERP machine API).

| Variable | Used by | Purpose |
|---|---|---|
| `ERP_BASE_URL` | all agents | The ERP machine API base (`http://localhost:3001`). |
| `ARSENAL_TOKEN` | all agents | Shared secret — **must equal the ERP's `ARSENAL_INGEST_TOKEN`.** |
| `LITELLM_BASE_URL` / `LITELLM_API_KEY` | reach | LLM gateway (reach reads the `LITELLM_*` names). |
| `LLM_BASE_URL` / `LLM_API_KEY` | satellite, ammoforge, glock, sleeper, rag, sales | LLM gateway (same gateway, `LLM_*` names). |
| `WHATSAPP_PROVIDER`, `SENDER_PHONE_NUMBER_ID`, `MANAGER_WHATSAPP_NUMBER`, `WHATSAPP_API_KEY` | reach, glock, sleeper | Manager WhatsApp notifications (Meta Cloud API). |
| `SALES_CALENDAR_ID` | glock | Calendar the agent books meetings on. |
| `SEARXNG_URL` | satellite | Web-search endpoint for prospecting (empty → public fallbacks). |

Set the same `LITELLM_*` and `LLM_*` to the same gateway URL/key — the two name styles
exist only because the agents were ported at different times.

## 4. `ai-stack/.env` — self-hosted AI infrastructure

A separate docker-compose world (LiteLLM proxy + Qdrant + SearXNG). Only relevant if you
run the AI stack locally. Its secrets (`LITELLM_MASTER_KEY`, `QDRANT_API_KEY`,
`SEARXNG_SECRET`, …) are independent of the app — the app only consumes the resulting
LiteLLM URL/key (which you copy into `erp-agents/.env`). Template: `ai-stack/.env.example`.

## 5. Google OAuth tokens — files, not env vars

Google hands out JSON token files; they can't live in `.env`.
- OAuth client: `erp-agents/workflows/<agent>/client_secret.json`
- Tokens (written on first consent): `erp-agents/workflows/<agent>/tokens/*.json` (dir set by `gmail_token_dir`)

Needed by: reach (Gmail send), glock (Gmail + Calendar), rag (Gmail drafts),
contractmaker (Google Docs/Drive).

---

## The shared-secret boundary (why a token appears "twice")

```
erp-agents/.env   ARSENAL_TOKEN         ─┐
                                         ├─ must be identical (one secret, two processes)
erp-server/.env   ARSENAL_INGEST_TOKEN  ─┘
```

The agents send `x-arsenal-token: <ARSENAL_TOKEN>`; the ERP checks it against
`ARSENAL_INGEST_TOKEN`. Each process needs its own copy because they're separate
runtimes — this is a shared secret, not accidental duplication. Local dev value:
`dev-arsenal-token-123`.

## Dev-only DB scripts

`erp-agents/scripts/demo_supplement.py` and `erp-agents/scripts/cleanup_demo.py` seed/clean
demo rows in Postgres directly. They are the only Python that needs the DB, and they read
`DATABASE_URL` from `erp-server/.env` (the DB owner) — not from `erp-agents/.env`.
