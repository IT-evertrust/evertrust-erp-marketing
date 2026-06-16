# SLEEPER GRENADE — Blueprint (ERP / PG)

**Spec:** n8n workflow `cZDGIoudM6yg17kV` — *EVERTRUST - SLEEPER GRENADE (PG)* (20 nodes).
**Python:** `erp-server/agents/sleeper/` (ERP-native; reach pattern).
**Role:** daily sweep of snooze-due prospects — re-engage the soft-no's, suppress the hard-no's.

> Supersedes the Drive/Sheets sweep. The snooze-date math is done **server-side** by the ERP
> (`GET /prospects?snoozeDue=true`); do-not-contact becomes a suppression + `DO_NOT_CONTACT`
> (the row is **kept, never deleted** — copy-before-delete is now "never delete").

## Trigger & I/O
- **Trigger:** daily 08:15. Python = `POST /sleeper/run`.
- **Output:** `{ runId, mode, prospects:[{email, prospectId, action, ...}], counts:{due,doNotContact,reengaged,skipped,errors} }`.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /prospects?snoozeDue=true&limit=100` | snooze-due prospects (ERP does the date math) |
| `POST /suppressions` `{email, reason:"do-not-contact", sourceProspectId}` | org-wide send gate |
| `PATCH /prospects/:id` `{status:"DO_NOT_CONTACT"}` / `{status:"RE_ENGAGED", lastContactedAt, followupCount+1}` | status update |
| `POST /outreach-messages` (OUTBOUND/SENT) | log the re-engage send |

## Flow (faithful)
Per snooze-due prospect:
- **do_not_contact** → `POST /suppressions` + `PATCH DO_NOT_CONTACT` (kept, not deleted).
- **otherwise** → AI re-engage draft (German, <120 words, JSON `{subject,body}`, fail-loud parse)
  → [approval] → Gmail send (Hanna) → `POST /outreach-messages` + `PATCH RE_ENGAGED`.

## Python implementation map
- `domain/models.py` — `Prospect`, `ReengageDraft`, `to_prospect`, `parse_draft` (fail-loud).
- `clients/erp.py` — `ErpGateway` + `ErpClient` (the 4 calls). **(new — replaces db.py)**
- `clients/llm.py` — `draft_reengage` (prompt verbatim) + `offline_reengage`.
- `clients/gmail.py` — minimal `send_text` (Hanna).
- `pipeline.py` — `run(settings, opts, erp, llm, gmail, whatsapp)`.
- `server.py` — `POST /sleeper/run`; injectable `get_erp/get_llm/get_gmail/get_whatsapp`.
- `settings.py` — central `.env`; `cli.py` (`--live`, `--no-llm`, `--limit`).

## Behaviour
- **Dry-run (default):** sweep + draft + decide, **no** suppression/send/status writes.
- **--live:** arms suppression, Gmail send, outreach log, status writes.

## Tests (`tests/`, all green — 8)
- `test_parse.py` — `parse_draft` fail-loud + `to_prospect` camel/snake mapping.
- `test_route_run.py` — route → sleeper → output (FakeErp/LLM/Gmail): dry counts with no writes;
  live = suppression + DO_NOT_CONTACT for the hard-no, Gmail send + outreach log + RE_ENGAGED for the soft-no.

## Credentials
- ERP `ARSENAL_TOKEN`; LiteLLM gateway (default model `gpt-4o`); Gmail OAuth (Hanna); WhatsApp token.

## Notes / deferred
- The n8n **WhatsApp send-and-wait approval gate** (manager approves each re-engage) is a
  human-in-the-loop step. The ERP-native agent defers approval to the ERP/manager UI — in `--live`
  it sends after drafting. Re-introduce a gate (e.g. an ERP approval queue) before unsupervised use.
