# REPLY GLOCK — Blueprint (ERP / PG)

**Spec:** n8n workflow `5QkBzSzK1UdxiE96` — *EVERTRUST - REPLY GLOCK (PG) v2* (74 nodes).
**Python:** `erp-server/agents/glock/` (ERP-native; reach pattern).
**Role:** processes inbound replies to cold outreach — classify, then book meetings / propose
slots / snooze. Consumes reach's sent prospects; feeds the sales pipeline (hot leads + meetings).

> Only the **lead-data layer** changed from the original REPLY GLOCK: campaign discovery,
> prospect lookup, and all verdict writebacks go through the ERP machine API instead of
> Drive/Sheets. Gmail reply detection, the classify/slot/agent prompts, calendar conflict
> logic, meeting booking, and WhatsApp are preserved verbatim (reused from the existing modules).

## Trigger & I/O
- **Trigger:** schedule every 15 min (replies). Python = `POST /glock/run`.
- **Output:** `{ runId, mode, campaigns, replies:[{email, prospectId, classification, action, ...}], counts }`.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /campaigns/machine/list?lifecycle=ACTIVE` | active campaigns (context) |
| `GET /campaigns/:id/config` | niche/region/project/sender + templates gate |
| `GET /prospects?email=&limit=1` | match a reply → prospect |
| `POST /outreach-messages` (INBOUND/RECEIVED) | log the inbound reply |
| `POST /reply-classifications` | verdict: INTERESTED / UNSURE / NOT_INTERESTED / SNOOZE / MEETING_REQUEST (+ snoozeUntil) |
| `POST /prospects/:id/graduate` (INTERESTED) | promote hot lead |
| `POST /notifications` | manager pings (parallel to WhatsApp) |

## Flow (faithful)
1. Build campaign context (list + config per campaign; templates gate).
2. Fetch unread `Re:` replies from Gmail (both inboxes), dedup by message id.
3. Per reply: resolve prospect (skip if unknown) → log inbound → **classify** (hermes) →
   - **Interested + a free named time** → book meeting (Calendar + Meet) + send confirmation +
     verdict `MEETING_REQUEST` + graduate.
   - **Interested (no/blocked time)** → propose 2 free slots (Calendar busy → `find_free_slots`),
     compose reply (AI agent), **stage a Gmail draft** (soft human gate) + verdict `INTERESTED` + graduate.
   - **Unsure** → verdict `UNSURE` (the RAG draft queue drafts a reply).
   - **Not Interested** → temporary ⇒ `SNOOZE` (+60d), permanent ⇒ `NOT_INTERESTED`.
   - mark read.
4. Recon summary (WhatsApp + notification).

## Python implementation map
- `clients/erp.py` — `ErpGateway` + `ErpClient` (the 7 calls above). **(new — replaces db.py)**
- `domain/classify.py` — classify prompt + `derive`/`offline_classify` (reused; verbatim).
- `domain/slots.py` — `find_free_slots`/`is_window_free`/`make_slot` (reused; CET/CEST fixed).
- `clients/gmail.py` — fetch/hydrate replies, send reply, **create draft**, mark read (reused).
- `clients/calendar.py` — `busy_windows` (external-party-only) + `create_meeting` (reused).
- `clients/llm.py` — `classify`, `pick_slot`, `draft_proposal` + offline stubs (reused).
- `pipeline.py` — `run(settings, opts, erp, gmail, calendar, llm, whatsapp)`.
- `server.py` — `POST /glock/run`; injectable `get_erp/get_gmail/get_calendar/get_llm/get_whatsapp`.
- `settings.py` — central `.env`; `cli.py` (`--live`, `--no-llm`).

## Behaviour
- **Dry-run (default):** classify + decide, **no** Calendar/Gmail/ERP writes, no mark-read.
- **--live:** arms booking, draft/confirmation send, verdict writebacks, graduate, mark-read.

## Tests (`tests/`, all green — 18)
- `test_classify.py`, `test_slots.py` (reused pure tests).
- `test_route_run.py` — route → glock → output (FakeErp/Gmail/Calendar/LLM): dry counts with
  no writes; live logs inbound + marks read + drafts proposal + graduates + writes
  INTERESTED/UNSURE/NOT_INTERESTED verdicts; unknown sender skipped.

## Credentials
- ERP `ARSENAL_TOKEN`; LiteLLM gateway (`LITELLM_BASE_URL/_API_KEY`, model hermes);
  **Gmail OAuth (info@ + hanna@, with `gmail.modify`)** + **Google Calendar OAuth**; WhatsApp token.

## Notes / deferred
- The "already-Interested → pick slot 1/2 → book" second-round path in n8n relies on slots
  persisted in n8n static data across runs. The ERP-native agent is stateless per invocation, so
  that path isn't reproduced; instead the **classify path already books** when a lead names a free
  time, and proposes fresh slots otherwise. Persisting proposed slots (an ERP store) would restore
  the exact two-round confirmation — deferred.
- Slot proposal is a **Gmail draft** (human reviews/sends), matching the workflow; meeting
  confirmation is auto-sent.
