# Migration Plan: n8n (PG) workflows → ERP-native Python agents

**Goal:** Reimplement the EVERTRUST automation agents as **Python backend logic that lives in
the ERP and is invoked by it** — replacing the n8n workflows. Each agent mirrors its n8n
**`(PG)`** workflow (the ERP-API rebuild), not the original Drive/Sheets workflow. The ERP
(machine API + Postgres) is the single source of truth and owns orchestration, governance,
state, and audit.

**Last updated:** 2026-06-15

> This supersedes the earlier "standalone mac-mini monorepo replacing n8n via Drive/Sheets +
> SQLite" plan. That pivoted: the agents now sit inside `erp-server/agents/`, read/write the
> **ERP machine API** (not Drive/Sheets/SQLite/Neon-direct), and are triggered **by the ERP**.

---

## 1. Architecture (how it actually works now)

```
client ── HTTP ──▶ ERP route (NestJS)  ──▶ agent service (Python, FastAPI)
                        ▲                         │
                        │   ERP machine API       │  reads send-list / config,
                        └─── (x-arsenal-token) ◀──┘  writes outreach/prospect/notify/callback
```

- **Agents are on-demand backend logic.** The ERP triggers an arsenal stage → calls the agent
  → the agent runs once, calls back, returns a structured result → the ERP records it. Same
  trigger model as the n8n webhooks it replaces; agents sleep until called.
- **Data layer = the ERP machine API** (`x-arsenal-token`). No Drive/Sheets reads, no SQLite,
  no direct Neon. Google APIs (Gmail/Calendar/Docs) remain **only as side-effect clients**
  (send mail, book meetings, render PDFs) — exactly as the `(PG)` workflows keep them.
- **The ERP owns governance & state:** eligibility/`sendList`, cooldown, follow-up caps,
  suppression, dedup, audit (`outreach_messages`, `arsenal_runs`, `notifications`). Agents
  don't reimplement these — they consume the gated send-list and report results.
- **Spec = the `(PG)` n8n workflow** for each agent (fetch with `n8n_get_workflow {mode:"full"}`).
  Each agent's BLUEPRINT is rewritten to that `(PG)` reality before/with the code conversion.

Location: `marketing-agent-workflows/erp-server/agents/<agent>/`. The repo root
(`marketing-agent-workflows/`) is the ERP monorepo (erp-server / erp-client / packages / ai-stack).

---

## 2. The reach reference pattern (the template for every agent)

`erp-server/agents/bazooka` (reach) is **done** and is the pattern to copy. Per agent:

```
<agent>/<agent>/
├── clients/
│   ├── erp.py        # ErpGateway Protocol + ErpClient (httpx, x-arsenal-token).
│   │                 #   The ONLY data layer. Injectable so tests use a fake.
│   ├── llm.py        # LiteLLM gateway call; prompt kept verbatim with the (PG) workflow;
│   │                 #   offline_fill() deterministic path for --no-llm / tests.
│   └── gmail.py / calendar.py / gdocs.py   # side-effects only, as the workflow needs
├── domain/
│   ├── models.py     # dataclasses matching the ERP shapes + parsing (e.g. template blocks)
│   ├── actions.py    # the decision matrix — pure, unit-tested, verbatim port of the
│   │                 #   workflow's "Compute Action" node
│   └── hygiene.py    # shared validators (email cleaning, etc.)
├── pipeline.py       # run(settings, opts, erp) -> dict   (the function the route calls)
├── server.py         # FastAPI: POST /<agent>/run + /health; get_erp is an injectable dep
├── settings.py       # reads the central .env (ERP_BASE_URL, ARSENAL_TOKEN, LLM, ...)
└── cli.py            # manual/cron entry: dry-run default, --live, --campaign, --limit
tests/
├── test_actions.py        # decision matrix
├── test_offline_fill.py   # placeholder/templating
└── test_route_run.py      # route → agent → output via TestClient + FakeErp (dry + live writes)
```

Invariants the pattern enforces (carried from the n8n era):
- **Dry-run is the default**; `--live` arms sends + ERP writes + the run callback.
- **Structured return, not crashes:** the route returns a JSON result (counts + per-item plan)
  even on empty input; per-item failures are caught and logged FAILED to the ERP, never abort
  the run; a run-level failure posts an `ERROR` callback + notification.
- **Governance is the ERP's**, consumed via `sendList`/config — agents don't re-derive it.
- **LLM concurrency is bounded** (the LiteLLM box is small); agents loop prospects sequentially
  or behind a small semaphore — never fan out unbounded LLM calls.
- **Anti-fabrication** (satellite): ID-join, copy-only extraction — no invented data.
- **db.py (Neon/psycopg) is deleted** once an agent is on `erp.py`.

---

## 3. Agent → canonical `(PG)` workflow

| Agent | (PG) workflow | n8n id | nodes | status |
|---|---|---|---|---|
| bazooka (reach) | REACH BAZOOKA (PG) v2 | `zyCTVLpZj3YyR2qV` | 57 | ✅ done |
| ammoforge | AMMO FORGE (PG) v2 | `rDLhY3sqi6U9xK6t` | 13 | ✅ done |
| satellite | LEAD SATELLITE copy 6 (PG) | `dCGzrlpaxpxJanbJ` | 47 | ✅ done |
| glock (reply) | REPLY GLOCK (PG) v2 | `5QkBzSzK1UdxiE96` | 74 | ✅ done |
| sleeper | SLEEPER GRENADE (PG) | `cZDGIoudM6yg17kV` | 20 | ✅ done |
| crm | CRM Customer (PG) | `vNCqzVjOOhSD2Czb` | 19 | ✅ done |
| rag | RAG AGENT (PG) | `ffd3c2uRgkMLFaxT` | 13 | ✅ done |
| contractmaker | ContractMaker (PG) | `wZWcjzx7fSbbsT7c` | 27 | ✅ done |
| sales | SALES AGENT (PG) | `OUNbboRQNqch5USk` | 29 | ✅ done |

Supporting (not agents): AIM v2 (PG) `QDvotfZeo03bZy7m` (campaign deploy); CAMPAIGNS LIST (ERP)
`29sRw4nD3U4C5vtT`; NICHE ANALYTICS `jgOVy4Ox9fCtpT7S`; DATA BACKFILL (sheets→PG) `XFxlPdyRfTyO6KX9`.

---

## 4. Per-agent conversion recipe (repeatable, one at a time)

For each agent, in order:

1. **Fetch the spec** — `n8n_get_workflow { id, mode: "full" }` for the `(PG)` workflow.
2. **Map it** — ERP endpoints called (+ payloads), the decision matrix, LLM prompts/models,
   side-effects (Gmail/Calendar/Docs), notifications, run callback, send caps.
3. **Rewrite the BLUEPRINT** (`AGENT-BLUEPRINTS/<agent>-BLUEPRINT.md`) to the `(PG)` reality
   (it currently describes the Drive-era workflow).
4. **Refactor the Python** to the reach pattern: `erp.py` gateway, `domain` (models + actions
   verbatim), `clients` (LLM + needed side-effects), `pipeline.run(settings, opts, erp)`,
   `server.py` route, `settings.py` (central `.env`). Delete `db.py`.
5. **Tests** — unit (actions, templating) + `test_route_run.py` (TestClient + FakeErp): dry
   (correct counts, zero writes) and live (correct ERP writes + callback). All green.
6. **Live check** — you provide creds + real data; run the agent's `/…/run` against the local
   ERP (`:3001`, ts-node) and verify output.

**Conversion order (pipeline-aware):**
`ammoforge → satellite → glock → sleeper → crm → rag → contractmaker → sales`.
Rationale: ammoforge (templates) + satellite (prospects) feed reach, making reach testable with
real data; ammoforge is small (13 nodes) — a clean first conversion. Glock/sleeper handle the
reply/re-engage side; crm/rag/contractmaker/sales are downstream.

After all agents: **build the ERP→agent wiring** (Section 6), starting with reach.

---

## 5. Environment & credentials

- **Central agents env:** `erp-server/agents/.env` (single source; every `<agent>/.env`
  symlinks to it). ERP backend keeps its own `erp-server/.env`; the only shared secret is the
  token — agents' `ARSENAL_TOKEN` must equal the server's `ARSENAL_INGEST_TOKEN`.
- **Local ERP:** boots under **ts-node** (not tsx — tsx/esbuild doesn't emit NestJS DI
  metadata). See `[[erp-reach-local-test]]` for the exact recipe; `/health` → `{db:true}` on `:3001`.

Credentials needed (user provides):

| Credential | env / form | used by | status |
|---|---|---|---|
| ERP machine token | `ARSENAL_TOKEN` = server `ARSENAL_INGEST_TOKEN` | all | dev set; real for prod |
| LiteLLM gateway URL + key | `LITELLM_BASE_URL`/`_API_KEY` (+ `LLM_*`) | reach, ammoforge, satellite, glock, contractmaker, rag, sales | ⛔ needed |
| Gmail OAuth — info@ | `client_secret.json` + tokens | reach, glock, rag | 📄 needed |
| Gmail OAuth — hanna@ | `client_secret.json` + tokens | reach | 📄 needed |
| Google Calendar OAuth | (Calendar scope) | glock | 📄 needed |
| Google Docs/Drive OAuth | (Docs/Drive scope) | contractmaker | 📄 needed |
| WhatsApp Meta Cloud token | `WHATSAPP_API_KEY` | reach, glock, sleeper | ⛔ needed |
| Database URL | `DATABASE_URL` | ERP backend + not-yet-converted agents | dev set (Neon) |
| SearXNG URL | `SEARXNG_URL` | satellite | optional |

---

## 6. ERP wiring & deployment (phase after the agents)

Once agents are converted, wire the ERP to call them (starting with reach):

- **Trigger:** the arsenal stage-run dispatcher calls the agent's `POST /<agent>/run` (replacing
  the `N8N_*_WEBHOOK_URL` target) and records the returned result.
- **Packaging (decision pending):** how the Python services run alongside the NestJS ERP —
  options: (a) one FastAPI app exposing every agent's route; (b) per-agent services; (c) ERP
  spawns the agent as a subprocess; (d) Docker service(s) in the stack. Reach currently runs as
  a standalone `uvicorn` service — fine for local; pick the prod packaging during this phase.
- **Cutover:** per agent, run the Python and the n8n `(PG)` workflow in parallel briefly, then
  point the ERP at the Python service and deactivate the n8n workflow.

---

## 7. Risks

1. **Double-sends during parallel running** — only one side armed live; the ERP's `sendList`
   gating + `outreach_messages` dedup is the backstop.
2. **OAuth setup** — own GCP client, consent once per Google account (info@, hanna@); budget an afternoon.
3. **LLM box limits** — bound LLM concurrency in each agent; keep prompts verbatim with the workflow.
4. **Spec drift** — the `(PG)` workflow JSON is the acceptance spec; each agent's `test_route_run.py`
   encodes its expected behaviour. Re-fetch the workflow if it changes.
5. **Packaging the Python runtime in prod** (Section 6) is the main open architectural decision.
