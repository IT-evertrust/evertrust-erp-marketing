# RAG AGENT — Blueprint (ERP / PG)

**Spec:** n8n workflow `ffd3c2uRgkMLFaxT` — *EVERTRUST - RAG AGENT (PG)* (13 nodes).
**Python:** `erp-server/agents/rag/` (ERP-native; reach pattern).
**Role:** drafts confident replies for leads marked **Unsure** (by Reply Glock). Drains the
RAG backlog hourly, drafts a Hanna-voice reply addressing the hesitation, and stores it as a
`suggestedReply` for human review.

> Supersedes the Drive folder scan + leads-sheet find-Unsure. The backlog is now
> `GET /reply-classifications?needsRag=true`; the thread is `GET /outreach-messages`; the draft
> is saved back to `/reply-classifications` (no Gmail draft — the human reviews in the ERP).

## Trigger & I/O
- **Trigger:** hourly. Python = `POST /rag/run`.
- **Output:** `{ runId, mode, drafts:[{prospectId, subject, unsureArea, status}], counts:{backlog,drafted,saved,errors} }`.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /reply-classifications?needsRag=true&limit=50` | UNSURE backlog needing a draft |
| `GET /outreach-messages?prospectId=&limit=50` | full thread context |
| `POST /reply-classifications` `{verdict:"UNSURE", model, raw, suggestedReply}` | save the draft |
| `POST /notifications` `{type:"RAG_DRAFT_READY", ...}` | notify reviewer |

## Logic (reuses the existing rich domain)
- `domain/thread.format_erp_thread(messages, lead_email)` — **new**: labels ERP outreach rows
  `[LEAD]` (INBOUND/from-lead) / `[EVERTRUST]`, oldest-first, last 20, body-cap 2000.
- `domain/prompts.{SYSTEM_PROMPT,build_system_prompt,build_user_prompt}` — the verbatim Hanna
  prompt (MODE A direct answer / MODE B brief stall, banned phrases, language mirroring,
  unsureArea closed set, strict-JSON output). Reused.
- `domain/parse.parse_reply` — fail-loud JSON → `ModelOutput` (validates `unsureArea`). Reused.
- `clients/llm.analyze` / `offline_analyze` — gpt-4o draft / offline stub. Reused.

## Python implementation map
- `clients/erp.py` — `ErpGateway` + `ErpClient` (the 4 calls). **(new — replaces db.py)**
- `pipeline.py` — `run(settings, opts, erp, llm)`: backlog → thread → prompt → draft → parse →
  (live) save + notify.
- `server.py` — `POST /rag/run`; injectable `get_erp/get_llm`. `settings.py`; `cli.py`.
- Dropped `clients/gmail.py` (PG saves to the ERP, doesn't send/draft in Gmail).

## Behaviour
- **Dry-run (default):** draft + parse, **no ERP writes**.
- **--live:** `POST /reply-classifications` (suggestedReply) + `POST /notifications`.

## Tests (`tests/`, all green — 37)
- Reused domain tests (`test_parse`, `test_enums`, `test_select`, `test_thread`, `test_offline`).
- `test_route_run.py` — route → rag → output (FakeErp + fake LLM): dry counts/no-writes; live
  saves `suggestedReply` + notifies; `unsureArea` validated against the closed set.

## Credentials
- ERP `ARSENAL_TOKEN`; LiteLLM gateway (default model `gpt-4o`). No Gmail.
