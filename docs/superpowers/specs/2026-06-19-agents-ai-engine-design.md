# Per-Org Agent LLM Wiring (AI Engine → Python agents)

**Date:** 2026-06-19
**Branch:** `feat/agents-ai-engine` (off `main`)
**Status:** Approved design — pending implementation plan

## Problem

The Configuration page's **AI Engine** card currently controls only the ERP's own
Anthropic/Claude calls (`engage.service`, `performance.service`, `ai/claude.service`).
It does **not** reach the Python agents in `erp-agents/`. Those agents resolve their LLM
purely from their own process env (`LLM_BASE_URL` / `EXTRACT_MODEL`), and the ERP→agent
dispatch (`arsenal.service.fireAgent`) sends only `{ live, source, campaignId, campaign }`
— no LLM fields. So an admin cannot point the agents at a local gateway/model from the UI,
and there is no per-tenant control of the agents' LLM.

Today's verified facts:
- AI Engine card saves `org_config.aiModel` (Claude models list) + `aiGateway` (a dead
  cosmetic *label* nothing reads functionally).
- Agent LLM is env-only; `fireAgent` body carries no model/gateway.
- All 5 arsenal-stage agents (satellite, ammoforge, bazooka, glock, sleeper) share the same
  shape: a `settings.py` with an `llm_base_url` field (bazooka uses `litellm_base_url`),
  a `server.py` with a `RunRequest` pydantic model, and a `clients/llm.py`.

## Goal

Let an admin configure, **per org**, the gateway URL + model the Python agents use, from the
AI Engine card, honoring the repo's non-negotiable multi-tenant rule
(`org value ?? env default`). v1 covers all 5 arsenal-stage agents.

## Decisions (locked during brainstorming)

1. **UI framing:** Extend the existing AI Engine card. Keep the Claude model selector (ERP
   features) and add a clearly-separated **Agent gateway** section (gateway URL + agent model).
2. **Credential storage:** Store per-org **URL + model** only (non-secret) in `org_config`.
   The API key is **not** stored per-org — it always resolves from env `LLM_API_KEY`. No new
   secret-at-rest pattern.
3. **Agent scope:** All 5 arsenal-stage agents honor the override in v1.
4. **Data flow (Approach A):** The ERP resolves the org's agent-LLM config and includes it in
   the dispatch POST it already sends. The agent stays stateless; one resolution point; no new
   agent→ERP coupling. (Rejected: B agent-fetches-back — more coupling; C push-to-env — not
   multi-tenant.)

## Design

### 1. Data model — `packages/db`

Add two nullable columns to `org_config`:

| Column | Type | Meaning |
|---|---|---|
| `agent_llm_base_url` | `text` null | Per-org agent gateway base URL (e.g. `https://…/v1`). Null → env `LLM_BASE_URL`. |
| `agent_llm_model` | `text` null | Per-org agent model (e.g. `hermes`). Null → env `EXTRACT_MODEL`. |

Drizzle migration generated via `db:generate`; no key column (key stays in env).

### 2. Shared DTOs — `@evertrust/shared`

Extend the AI Engine config contract (do not create a parallel one):

```ts
AiEngineConfigDto = z.object({
  model:        z.string().nullable(),  // existing — ERP Claude model
  gateway:      z.string().nullable(),  // existing — cosmetic label (left as-is, v1)
  agentGateway: z.string().nullable(),  // NEW — agent gateway URL
  agentModel:   z.string().nullable(),  // NEW — agent model
});
// UpdateAiEngineDto: same two new optional fields (value sets, null clears, omit = unchanged).
```

GET never returns any API key.

### 3. Backend — `erp-server`

- **`WorkflowConfigService`**
  - Persist + return `agentGateway` (`org_config.agent_llm_base_url`) and `agentModel`
    (`org_config.agent_llm_model`) alongside the existing AI engine fields, reusing the
    existing `clean()` blank→null handling.
  - Add `resolveAgentLlm(orgId)` →
    `{ baseUrl: org.agentLlmBaseUrl ?? env.LLM_BASE_URL, model: org.agentLlmModel ?? env.EXTRACT_MODEL, apiKey: env.LLM_API_KEY }`.
  - Add `LLM_BASE_URL`, `EXTRACT_MODEL`, `LLM_API_KEY` to the env schema
    (`config/env.schema.ts`) as optional, so the resolver has a typed default source.
- **`arsenal.service.fireAgent`**
  - Resolve `resolveAgentLlm(orgId)` for the run's org and include in the POST body:
    `{ live, source, campaignId, campaign, llmBaseUrl, model, apiKey }`.
  - `orgId` is already in scope in the stage-fire path.

### 4. Agent contract — all 5 arsenal agents

Each `server.py`:
- `RunRequest` gains optional `llmBaseUrl: str | None`, `model: str | None`, `apiKey: str | None`.
- The run route applies the override over env before calling the pipeline:
  `settings = dataclasses.replace(load_settings(), llm_base_url=req.llmBaseUrl or s.llm_base_url, …)`
  (map to `litellm_base_url` for bazooka; map `model` to each agent's model field —
  `lead_model`/`email_model`/etc.). When a field is absent the agent keeps its env default
  (`request value ?? env default`).
- The manual CLI path (`python -m <agent>`) is unchanged — env-only — and this is documented.

### 5. Frontend — `erp-client`

- `AiEngineCard` (in `components/settings/configuration-settings.tsx`): add an **Agent gateway**
  sub-section below the Claude selector — a gateway-URL `Input` and an agent-model `Input`
  (free text; local model ids are not in `AI_ENGINE_MODELS`). Seed from the GET, save via the
  extended `useUpdateAiEngineConfig`. Blank clears (→ env default).
- Add i18n keys under `config.ai.*` (en + de).

### 6. Security

- API key is never sent to the browser (GET returns only URL + model).
- The key travels **only** ERP→agent inside the server-to-server dispatch body.
- Agent stays stateless; no per-org secret stored at rest.

## Component boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `org_config` columns | Store per-org agent URL + model | — |
| `AiEngineConfigDto` | Wire contract UI ↔ API | zod |
| `WorkflowConfigService.resolveAgentLlm` | `org ?? env` resolution | org_config, env schema |
| `arsenal.service.fireAgent` | Inject resolved LLM into dispatch | resolveAgentLlm |
| agent `RunRequest` + route | Apply `request ?? env` to settings | settings, pipeline |
| `AiEngineCard` agent section | Admin edits URL + model | DTO, hooks |

## Testing

- **API (jest):**
  - `workflow-config.service.spec`: `resolveAgentLlm` returns org value when set, env default
    when null/blank.
  - `arsenal.service` (or its spec): `fireAgent` body includes `llmBaseUrl`/`model`/`apiKey`.
- **Agents (pytest):** per agent, a route test posting `{ llmBaseUrl, model }` asserts the
  override reaches `settings` (e.g. via a captured fake or an offline assertion). 5 agents.
- **Static:** `pnpm --filter @evertrust/web typecheck`, `pnpm --filter @evertrust/api test`,
  agent `pytest` per package.

## Out of scope (v1)

- Per-org API **key** storage (key stays env-global).
- Removing/repurposing the cosmetic `aiGateway` label field.
- The non-arsenal agents (crm, rag, contractmaker, sales) — not on the arsenal dispatch path.
- The manual CLI override (env-only by design).
- A live end-to-end run against the Mac gateway (separate task; needs the agent `.env` +
  network reachability).

## Risks / notes

- **bazooka field name** differs (`litellm_base_url` / `LITELLM_BASE_URL`) — handle explicitly.
- Each agent maps `model` to its own field(s) (`lead_model`, `email_model`, `news_model`,
  `forge_model`) — confirm per agent during implementation.
- `requires-python>=3.11` on the agents vs the local 3.9 dev box: tests run under the 3.9 venv
  with `eval_type_backport` (already used this session); CI/prod should use 3.11+.
