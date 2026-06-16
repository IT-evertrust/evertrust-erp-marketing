# SALES AGENT — Blueprint (ERP / PG)

**Spec:** n8n workflow `OUNbboRQNqch5USk` — *EVERTRUST - SALES AGENT (PG)* (29 nodes).
**Python:** `erp-server/agents/sales/` (ERP-native; reach pattern).
**Role:** sales-call coach — scores a meeting transcript through a configurable persona lens
(Alex Hormozi) and returns a structured analysis (+ optionally persists a rendered report).

> Supersedes the Drive persona-Docs + report-Doc + tracking-Sheet. The Hormozi scoring
> (hermes via LiteLLM) is unchanged. Personas come from `GET /personas`; the rendered analysis
> is saved to `POST /meeting-analyses`.

## Trigger & I/O
- **Trigger:** Read.ai webhook / ERP analyze webhook / manual. Python = `POST /sales/run
  { transcript, persona, source }`.
- **Output:** `{ runId, mode, source, status, persona, analysis | row, persisted }`.
  `status` ∈ ok / invalid / error.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /personas?limit=50` | persona name + prompt |
| `POST /meeting-analyses` | persist the rendered analysis (non-erp sources) |

(The n8n service webhooks `GET /personas` / `GET /meeting-analyses` just proxy the ERP — the
ERP UI calls those directly, so they aren't reproduced.)

## Flow (faithful)
1. **Validate transcript** (`transcript.validate_transcript`): ≥100 words, ≥4 turns, salesperson
   speaks; flags `low_client_engagement` (forces low buying-intent context).
2. **Resolve persona** — `GET /personas` → exact → substring → first match.
3. **Coach** (`rubric.build_system_message(persona_prompt)` + the strict-JSON output format;
   hermes via LiteLLM) → analysis JSON.
4. **Parse** (`parse.parse_analysis_json`, required keys: overall_summary,
   sales_technique_analysis, performance_score, client_analysis).
5. **Route by source:** `erp` → return the analysis JSON (no persist); else → `render.build_row`
   + `build_report` → `POST /meeting-analyses`.

## Python implementation map (reuses existing modules)
- `readai.adapt`, `domain/transcript.{validate_transcript,adapt_readai,flatten_erp}`,
  `domain/rubric.build_system_message`, `domain/parse.parse_analysis_json`,
  `domain/render.{build_row,build_report}`, `clients/llm.{sales_coach,offline_coach}` — reused.
- `clients/erp.py` — `ErpGateway` + `ErpClient` (`get_personas`, `save_meeting_analysis`). **(new — replaces db.py)**
- `pipeline.py` — `run(settings, opts, erp, llm)` (+ `_resolve_persona`).
- `server.py` — `POST /sales/run`; injectable `get_erp/get_llm`. `settings.py`; `cli.py`.

## Behaviour
- **Dry-run (default):** analyze, do NOT persist. **--live:** persist (non-erp sources).
- ERP-source callers always get the analysis JSON back and never persist (the ERP stores it).
- Invalid transcripts return `status: invalid` (with the reason) — never scored.

## Tests (`tests/`, all green — 29)
- Reused domain tests (`test_parse`, `test_rubric_render_llm`, `test_transcript`).
- `test_route_run.py` — route → sales → output (FakeErp + real offline coach): erp-source returns
  analysis JSON (no persist); manual+live renders + persists (report_html + scores); invalid transcript skip.

## Credentials
- ERP `ARSENAL_TOKEN`; LiteLLM gateway (model `hermes`). No Gmail/Drive.
