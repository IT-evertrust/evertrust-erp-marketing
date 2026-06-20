# Engage agents port — change log (2026-06-19)

Scope: fix the new modular-monolith foundation (clients/core/schemas), build **Reply Glock** and
**RAG Agent** in the new architecture faithful to their n8n (PG) counterparts, remove the now-redundant
old `work-flows/` packages for those two. Everything below is "what changed and why."

## Architectural decision that frames the port

The n8n REPLY GLOCK (PG) (74 nodes) auto-books meetings, sends Gmail, notifies WhatsApp, and writes to
the ERP inline. In the **ERP-driven model** (MIGRATION_PLAN), the agent is the *brain* and the backend
owns orchestration, state, and side-effects. So the ports reproduce the n8n **classification + draft
logic faithfully** but leave sending / booking / persistence to the backend (next phase). Each workflow
is pure **JSON in → structured `AgentResult` out**, which also matches the handoff spec's Engage UX (a
human reviews/edits/sends drafts in the queue) and the build sequence (agents → backend → frontend → DB).

## 0. Package restructure

- **Moved `src/agents/` → `src/erp_agents/`** to match every `from erp_agents...` import and the spec.
- **`pyproject.toml`**: added `[project]` (name/version/deps), `[build-system]`, `[tool.setuptools.packages.find] where=["src"]`,
  and pytest `pythonpath=["src"]`. Before this there was no package table, so `import erp_agents` resolved to nothing.

## 1. Foundation fixes

### settings.py
- `agent_port 80001 → 8001` (80001 is not a valid port).
- `llm_provider "qwen3.5" → "hermes"`; added `llm_base_url`; `llm_model` default `"hermes"`.
- Added **AliasChoices** so one Settings reads both spec names and the real `.env` names:
  `ERP_API_URL|ERP_BASE_URL`, `ERP_AGENT_TOKEN|ARSENAL_TOKEN`, `LLM_BASE_URL|LITELLM_BASE_URL`,
  `LLM_API_KEY|LITELLM_API_KEY`, `LLM_MODEL|OPENAI_MODEL`, `GOOGLE_CALENDAR_ID|SALES_CALENDAR_ID`,
  `WHATSAPP_PHONE_NUMBER_ID|SENDER_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN|WHATSAPP_API_KEY`.
- `extra="ignore"` so the many unrelated keys in the team `.env` (SEARXNG_*, LEAD_*) don't error.

### core/
- `result.py` — `AgentTraceStep.input/output` were `dict` (default_factory); changed to `dict | None = None`
  per spec, so trace steps can omit input/output (e.g. `compose_output`).
- `registry.py` — was broken (typo `reah`, imported 6 classes that don't exist → NameError on import).
  Rewritten to register only what exists: `engage.reply_glock`, `engage.rag_agent`; added `get_workflow(name)`
  with a helpful KeyError. `job.py` (`workflow` field) and `workflow.py` (imports `core.result`) were already correct.
- Added `core/__init__.py` (exports AgentJob/AgentResult/AgentTraceStep/Workflow) and a real `logging.py`.

### clients/
- **Renamed `google_oauth.py` → `google_auth.py`** (gmail/calendar imported `google_auth`; spec name too).
- **`llm_client.py`** — was fundamentally broken (`self.client = api_key` string; read nonexistent
  `settings.openai_model`; `raise … from exc` syntax error). Rewrote to construct
  `OpenAI(api_key=…, base_url=settings.llm_base_url)` against the **Hermes gateway**, with a robust
  JSON parse (extract first `{…}`) + a retry without `response_format` for models that reject it.
- **`gmail_client.py`** — fixed tuple-by-trailing-comma on `self.service`/credentials, `b64decode → b64encode`,
  keyword-only call mismatch, and a syntax error in `send_email` (`bcc str|None`, `sef.user_id`,
  missing comma); `users().send()` → `users().messages().send()`.
- **`google_calendar_client.py`** — fixed scope URLs (`www.googleapis.com`), tuple-by-comma on
  `service`/`calendar_id`, `singelEvents → singleEvents`, `timeZone/calendarId` undefined-var bugs;
  `create_events → create_event`.
- **`whatsapp_client.py`** — `self.base_url` was a `set` literal; made it a string with the missing `/`;
  `phonen → phone`, `"type": text → "text"`, `message_product → messaging_product`.
- **`read_ai_client.py`** — `Content_Type → Content-Type`, `isInstance → isinstance`, `.rstrip("/")`.
- **`erp_client.py`** — kept generic get/post/patch; **switched the auth header `x-agent-token` →
  `x-arsenal-token`** to match the real NestJS `ArsenalTokenGuard` + every n8n (PG) workflow; replaced the
  invented `/growth/reach/aims/*` helpers with the real machine endpoints the engage agents use in live
  mode (`get_thread`, `get_rag_backlog`, `post_reply_classification`, `graduate_prospect`,
  `post_notification`). Only used in live mode — the v1 agents run brain-only.
- **Added `google_docs_client.py`** (was imported by `clients/__init__` but missing → package import crash).

### schemas/
- Filled `common.py` (Evidence / ContactPoint / CompanyProfile) + `__init__.py` export; `engage.py` got a
  docstring placeholder; `reach/activate/nurture.py` left as valid empty placeholders.

## 2. Reply Glock (`workflows/engage/reply_glock/`) — faithful to n8n `5QkBzSzK1UdxiE96`

Built as class-based steps: `validate_input → normalize_reply → classify_reply → draft_reply → compose_output`.

- **models.py** — fixed the scaffold's bugs (`Literal` unimported, trailing-comma tuple, `MANNUAL_REVIEW`,
  `MOVE_TO_METTING`, `from_emai`, `sks_for_pricing`, `sender_email` made required). Kept the handoff's
  4-status contract as the Engage-queue shape.
- **Status mapping (faithfulness):** the n8n classifier emits Interested / Unsure / Not-Interested+niType.
  Flattened into the 4 buckets: INTERESTED←Interested, UNSURE←Unsure, **TEMPORARY←Not-Interested+temporary**,
  **UNINTERESTED←Not-Interested+permanent**. Carried over the n8n bias rules into the prompt: don't
  over-classify INTERESTED; remove/opt-out → UNINTERESTED; timing → TEMPORARY; **when torn, prefer
  TEMPORARY** (suppression is irreversible).
- **prompts.py** — wrote the classify + draft prompts (were 4 empty strings). Draft prompt carries the n8n
  "Hanna" voice: decisive, never apologetic, banned phrases, German/English matching, max 3 sentences/para,
  one CTA, sign as the campaign sender; INTERESTED → propose a meeting/next step.
- **tools.py** — rewrote `clean_email_body` so it actually strips quotes/signatures; kept
  `recommended_action_for_status` / `ui_bucket_for_status`; added `default_snooze_date()` = today + **60d**
  (n8n `SNOOZE_DAYS`) used as the TEMPORARY follow-up window when the lead gave no explicit date.

**Intentional divergences (agent=brain):** no Gmail send/draft, no Calendar booking, no graduate, no
WhatsApp, no `/reply-classifications` write — those are the n8n side-effect subtrees, deferred to the
backend phase. The n8n "already-INTERESTED slot-confirmation" branch is also out of scope here (it needs
calendar + the live thread, which the backend will orchestrate).

## 3. RAG Agent (`workflows/engage/rag_agent/`) — faithful to n8n `ffd3c2uRgkMLFaxT`

New package (folder was empty). Steps: `validate_input → format_thread → build_prompt → LLM → validate_output`.

- **Grounding: thread-only** (confirmed against both sources) — no Drive / knowledge base / Qdrant.
- **prompts.py** — the verbatim "Hanna" RAG system prompt (MODE A direct answer / MODE B brief stall,
  banned phrases, salutation + closer rules, meeting/reference patterns, 7-field output) + the
  `Lead context + thread` user prompt.
- **tools.py** — `format_thread` ports the n8n `fmtThread`: oldest-first, last **20** messages,
  `[LEAD]`/`[EVERTRUST]` labels, body capped at **2000** chars, `[no prior messages on file]` when empty.
  `normalize_draft` ports `Parse Draft`: citations coerced to `list[str]`, empty `draftReply` → error,
  `unsureArea` must be in the closed set (Finance / Operation / Organization / Legality /
  Reference - Past Projects/Wins).
- **models.py** — `RagAgentOutput` uses field aliases so the LLM's camelCase JSON validates directly.

**Intentional divergences:** **model = Hermes** via the gateway (n8n used `gpt-4o`) per the local-model
mandate — noted in the workflow docstring. Live ERP writes (`POST /reply-classifications {verdict:UNSURE,
suggestedReply}` + `POST /notifications {RAG_DRAFT_READY}`) are deferred to the backend phase; v1 returns
the structured draft for review.

## 4. Removed redundant old agents

- Deleted **`work-flows/glock/`** and **`work-flows/rag/`** (now superseded by the new ports; ~286 MB incl. venvs).
- Updated `scripts/run-pipeline-agents.sh` to drop their entries (with a note pointing at the new location).
- **Kept** `work-flows/{ammoforge, bazooka, contractmaker, crm, sales, satellite, sleeper}` — these are
  NOT yet ported, so they remain the fidelity reference for their future ports. Removing them now would be premature.

## 5. Verification

- Foundation imports clean; full package + all clients + schemas + registry import; `compileall` clean (no syntax errors).
- **Offline pipeline (fake LLM):** both workflows return `status=success` with correct traces
  (glock: validate→normalize→classify_prompt→classify_llm→draft_prompt→draft_llm→compose; rag:
  validate→format_thread→build_prompt→draft_llm→validate_output).
- **Live CLI:** reached the LLM step and **authenticated to the Hermes gateway** (got `502`, not `401/404`),
  and the workflow degraded gracefully (`status=failed`, error captured, partial trace). `GET /v1/models`
  also `502` → the LiteLLM gateway / Funnel on the mac-mini is currently down (known memory-pressure issue,
  see lessons.md). A green live run is gated only on the gateway being healthy — not on the code.

## 6. Credentials still needed (to FUNCTION)

| Need | Variable(s) | Required for |
|---|---|---|
| **Hermes gateway up + key** | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL=hermes` | **both** — the only thing needed for v1 dry-run. Gateway must be reachable (currently 502). |
| ERP machine token | `ERP_AGENT_TOKEN` (= ERP `ARSENAL_INGEST_TOKEN`) | later — live ERP writes (reply-classifications, notifications, graduate) |
| Gmail OAuth (info@, hanna@) | `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` | later — Reply Glock send/draft (backend phase) |
| Google Calendar OAuth | (calendar scope) | later — meeting booking (backend phase) |
| WhatsApp Cloud API | `WHATSAPP_*` | later — manager notifications |

For the current goal (engage agents running on local JSON), **only the Hermes gateway is required.**
