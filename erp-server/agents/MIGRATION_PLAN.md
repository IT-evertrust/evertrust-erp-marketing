# Migration Plan: n8n → Local Agent Pipeline

**Goal:** Run the EVERTRUST automation stack as local code on the mac-mini (the box already
running LiteLLM + Ollama/hermes + SearXNG), with n8n workflows kept only as frozen blueprints.
n8n stops being a runtime dependency.

**Date:** 2026-06-12

---

## 1. What's actually in n8n today (inventory & triage)

34 workflows, but most are copies, temps, and debug scaffolding. The canonical set to migrate:

| Workflow | Trigger | Status | Migration notes |
|---|---|---|---|
| EVERTRUST - AIM | schedule | **active** | targeting/orchestration head of pipeline |
| EVERTRUST - LEAD SATELLITE | webhook + Drive poll + manual | inactive (6 variants!) | **decide canonical variant first** — copy 5 "SEAR batched" is the newest engineering, V2 "Real Search + Local AI" is the alternate architecture |
| WF-03 Segment Worker (SEAR v3) | sub-workflow call | inactive | fan-out child — disappears entirely in code (becomes an async function) |
| EVERTRUST - AMMO FORGE | schedule | **active** | uses OpenAI web search for demand drivers |
| EVERTRUST — REACH BAZOOKA | schedule | inactive | outbound cold email — highest side-effect risk |
| EVERTRUST - REPLY GLOCK | schedule/Gmail poll | inactive | reply classification via hermes gateway |
| EVERTRUST - SLEEPER GRENADE | schedule | inactive | snooze/do-not-contact sweep, copy-before-delete |
| EVERTRUST - CRM Hot Leads | webhook + Drive poll | inactive | sheet provisioning |
| EVERTRUST - CRM Customer | schedule | inactive | CRM state machine |
| EVERTRUST — ContractMaker v2 | Read.ai webhook | **active** | inbound webhook must keep a stable URL |
| EVERTRUST - RAG AGENT | hourly | **active** | Unsure-lead analysis, Gmail threads, agent drafts |
| EVERTRUST - CAMPAIGNS LIST (ERP) | GET webhook | inactive | read-only — perfect first migration |
| ACTIVATE - SALES AGENT | Read.ai/manual | inactive | Hormozi transcript scoring on hermes; audit plan in flight |
| Kairos - Listings Scraper | daily schedule | inactive | Apify + Supabase, independent of EVERTRUST |

**Not migrated:** all `copy`, `ZZ`, `TEMP`, `TEST`, `SIM` workflows, LLM AB HARNESS (becomes a
pytest suite), Setup one-shots, REACH BAZOOKA test, Reply Glock copy, old Lead Satellite variants.

---

## 2. Target architecture

One Python 3.12 monorepo (`evertrust-pipeline/`) running on the mac-mini as a single
launchd-managed service. Deterministic orchestration in code; LLM calls only where n8n had
AI Agent / LLM nodes. No workflow engine — n8n's value (visual graph, retries, scheduling,
credentials) gets replaced by ~5 small pieces of infrastructure you control:

```
evertrust-pipeline/
├── blueprints/            # exported n8n JSON, frozen, reference-only
├── core/
│   ├── config.py          # .env + per-campaign config.json loader
│   ├── google.py          # Drive / Sheets / Docs / Gmail (own OAuth client, google-auth)
│   ├── llm.py             # LiteLLM gateway client + pydantic structured output + retry
│   ├── search.py          # SearXNG client (+ DDG/Mojeek rotation from Satellite V2)
│   ├── notify.py          # WhatsApp alerts (failure + approval messages)
│   ├── state.py           # SQLite: run journal, dedup keys, snooze list, lead state
│   └── runner.py          # job wrapper: logging, retries, failure notification, dry-run flag
├── pipelines/
│   ├── lead_satellite.py
│   ├── ammo_forge.py
│   ├── reach_bazooka.py
│   ├── reply_glock.py
│   ├── sleeper_grenade.py
│   ├── crm.py             # hot leads + customer graduation
│   ├── contract_maker.py
│   ├── rag_agent.py
│   ├── sales_agent.py
│   └── kairos_zillow.py
├── server.py              # FastAPI: Read.ai webhook, ERP endpoints, manual-trigger routes
├── scheduler.py           # APScheduler inside the same process (replaces Schedule Triggers)
└── tests/                 # incl. the LLM A/B harness as pytest with canned replies
```

### n8n concept → local equivalent

| n8n | Local replacement |
|---|---|
| Schedule Trigger | APScheduler job (cron expressions kept identical) |
| Webhook Trigger | FastAPI route, exposed via Tailscale Funnel (already used for SearXNG) |
| Drive "On New Folder" poll | scheduled poll job + SQLite seen-set |
| Credentials store | `.env` for API keys; Google OAuth refresh tokens on disk (or Keychain) via own GCP OAuth client |
| Data Tables | SQLite tables (kills the project-scoping gotcha) |
| Executions list | `runs` table in SQLite + structured log files; WhatsApp ping on failure |
| AI Agent node + structured output parser | direct LiteLLM call + pydantic model validation, fail-fast, retries capped at 2 (matches SEAR v3 design) |
| splitInBatches + Wait + child-workflow fan-out | `asyncio` loop with a **global semaphore** (the entire "SEAR batched" concurrency dance collapses into ~10 lines) |
| Error workflow / onError continue | try/except per item + runner-level failure notification |
| Manual trigger | CLI: `python -m pipelines.lead_satellite --campaign X [--dry-run]` |

### Hard rules carried over from the n8n era

- **Global LLM semaphore = 1–2.** The 8GB M2 cap is physical; enforce it in `core/llm.py`,
  not per-pipeline.
- **Loud failures.** Zero-rows guards raise, never silently stop (the execution-5420 lesson).
- **Copy-before-delete** everywhere Sleeper Grenade touches rows.
- **Anti-fabrication:** ID-join copy-only extraction from Satellite V2 stays.
- **Idempotency keys** on every outbound send (Gmail message dedup in SQLite) — critical
  during the parallel-run period so n8n and local code never double-send.
- **`--dry-run` on every pipeline** — prints intended side effects without executing them.

---

## 3. Migration phases (strangler pattern — one workflow at a time, shadow first)

### Phase 0 — Freeze & export (½ day)
- Export canonical workflow JSONs into `blueprints/` (via n8n-mcp `n8n_get_workflow`).
- Write a one-page spec per workflow: trigger, inputs, outputs, side effects, credentials,
  known issues. The JSON is the ground truth for parameters; the spec is the contract.
- **Decision required:** pick the canonical Lead Satellite variant (copy 5 SEAR-batched vs V2
  Real-Search). Recommendation: V2's search/extract architecture + drop all the batching
  machinery (unnecessary in code).

### Phase 1 — Foundation (1–2 days)
- Repo scaffold, `core/` clients, SQLite schema, runner, FastAPI + APScheduler service,
  launchd plist with KeepAlive.
- **Google OAuth is the long pole:** create your own GCP OAuth client with Drive, Sheets,
  Docs, Gmail scopes; run the consent flow once per account (info@ and hanna@); store refresh
  tokens locally. n8n's stored tokens are not portable.
- Smoke tests: list Drive campaign folders, read a sheet, hermes round-trip via LiteLLM,
  SearXNG query, WhatsApp test message.

### Phase 2 — Low-risk read-only migrations (1 day)
1. **CAMPAIGNS LIST (ERP)** — read-only GET, trivially comparable. Repoint ERP to the new URL.
2. **RAG AGENT (shadow mode)** — run hourly against a test campaign or write to a
   `Unsure_Analysis_SHADOW` sheet; diff against the n8n version for a few days.

### Phase 3 — Lead Satellite (2–3 days) — biggest payoff
The profiler bypass, retry wrappers, metro multi-pass, batched fan-out, 90s parks, and the
Segment Worker child workflow all exist *because* n8n made concurrency hard. In code this is:
search → fetch → extract → email-recovery as async stages behind the LLM semaphore.
- Shadow-run against the copy-3 sandbox campaign; compare output sheets row-for-row.
- Port the Cloudflare cfemail XOR decode + contact-page scrape as a plain function.

### Phase 4 — Side-effecting outbound (2–3 days, most careful)
- **Reply Glock** first (classification mostly; sends are limited), then **Reach Bazooka**
  (cold email), then **Sleeper Grenade**.
- Every send path: dry-run default, idempotency key check, explicit `--live` flag to arm.
- Keep the WhatsApp approval gates — FastAPI endpoint or simple reply-to-approve.
- The LLM A/B harness becomes `tests/test_reply_classification.py` with the 5 canned replies.

### Phase 5 — Webhook consumers + remaining (1–2 days)
- **ContractMaker v2:** stand up the FastAPI route, repoint Read.ai webhook, replay a logged
  meeting payload to verify, then deactivate the n8n version.
- **CRM Hot Leads / Customer**, **AIM**, **Ammo Forge**, **Sales Agent** (fold in the planned
  persona/rubric audit fixes while porting), **Kairos Zillow**.

### Phase 6 — Decommission
- Each pipeline: ≥1 week clean parallel/shadow operation → deactivate the n8n workflow.
- When all are off: export a final full backup of the instance, keep n8n stopped (not
  deleted) for a month as archive, then remove.

---

## 4. What you gain / what you lose

**Gain:** git history and real diffs; pytest instead of throwaway debug workflows; concurrency
you can actually control; no Data Table scoping or webhook path-collision gotchas; one
process to monitor; everything runs even if the n8n container is down.

**Lose (and mitigations):**
- Visual graph → the per-workflow spec doc + clear stage functions.
- Executions UI → `runs` table + `python -m core.state tail` (or a 50-line status page later).
- Built-in OAuth flows → one-time GCP client setup (Phase 1).
- Easy manual re-trigger from a UI → CLI commands per pipeline.

## 5. Risks

1. **Double-sends during parallel running** — idempotency keys + only ever one side armed live.
2. **OAuth scope/verification friction** with Google (unverified-app warnings for own OAuth
   client are fine for personal use, but budget an afternoon).
3. **Webhook URL changes** — Read.ai and the ERP must be repointed; do it per-consumer with
   a rollback path (n8n workflow stays activatable for a week).
4. **mac-mini as single point of failure** — it already is (LiteLLM/SearXNG); add launchd
   KeepAlive + a daily heartbeat WhatsApp/log line.
5. **Silent drift from blueprint** — the exported JSONs in `blueprints/` are the acceptance
   spec; each ported pipeline gets a shadow-comparison before go-live.

## 6. Rough total effort

~8–12 working days end-to-end, front-loaded on Phase 1 (foundation + OAuth) and Phase 3
(Lead Satellite). Phases 2–5 each end with a deactivated n8n workflow, so value lands
incrementally — no big-bang cutover.
