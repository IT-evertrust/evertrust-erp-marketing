# Engage end-to-end link — change log (2026-06-19)

Wired the Engage vertical across all three layers: **agent server → backend module → frontend**.
Goal: the Engage page shows real DB data (not mock), the backend owns validate/sanitize/DB/agent-IO,
and the agent stays brain-only. UI left visually identical.

## Was the backend linked to the agent? No — now it is.
Two gaps existed: (1) the agent monolith had no HTTP server; (2) the backend's only agent path was the
async arsenal fire-and-callback (campaign batch), not a synchronous per-reply call. Both closed below.

## Layer 1 — agent server (erp-agents)
- NEW `src/erp_agents/server.py`: FastAPI `POST /run { workflow, mode, input }` → `AgentResult` (sync),
  `GET /health`. Unknown workflow → 404; a failed run → 200 with `status:"failed"` (caller decides).
- pyproject += `fastapi`, `uvicorn`. Run: `uvicorn erp_agents.server:app --port 8001`.
- Verified: TestClient + real uvicorn boot — `/health` lists both workflows, `/run` reaches the LLM
  (502 = the down Hermes gateway, captured gracefully).

## Layer 2 — backend engage module (erp-server `src/modules/(growth)/engage/`)
Replaced the in-memory mock stub with a DB-backed module that follows the growth self-contained pattern.
- `engage.agent.ts` — `EngageAgentClient`: POSTs `${AGENTS_BASE_URL}/run`; a failed AgentResult → 503.
- `engage.repository.ts` — DB reads (org-scoped via prospect): `listCampaigns` (with reply counts),
  `findRepliesByCampaign` (assembles prospects + outreach_messages + reply_classifications →
  EngageReply), `getThread`, `updateDraft` (edits the latest classification's suggestedReply),
  `prospectsNeedingClassification`, and `seedDemo` (3 classified demo replies into a campaign).
- `engage.service.ts` — builds the agent input from the DB, calls Reply Glock / RAG, maps the 4-status
  output → DB verdict (TEMPORARY→SNOOZE, UNINTERESTED→NOT_INTERESTED), and persists via the REUSED
  `ReplyClassificationsService.create` (verdict projection + audit). Send + AI-feedback are real
  endpoints that 503 ("pending Google sign-in") — deferred to the OAuth phase.
- `engage.controller.ts` — `GET /growth/engage/campaigns`, `GET …/campaigns/:id/replies`,
  `POST …/campaigns/:id/classify`, `GET …/replies/:id/thread`, `POST …/replies/:id/run-reply-glock`,
  `POST …/replies/:id/run-rag`, `PATCH …/replies/:id/draft`, `POST …/replies/:id/send` (503),
  `POST …/replies/:id/ai-feedback` (503), `POST …/demo-seed`. `replyId` = prospectId. Org-scoped via @OrgId.
- Reuse: OutreachModule now EXPORTS `OutreachMessagesService` + `ReplyClassificationsService`; GrowthModule
  imports it. New env `AGENTS_BASE_URL` (blank = engage agent runs 503).
- Verified: `@evertrust/api` typecheck clean; jest **49 suites / 419 tests green**.

## Layer 3 — frontend rewire (erp-client `src/modules/(growth)/engage/`)
- ONLY `services/engage.service.ts` (now fetches `/growth/engage/*` + maps backend → the local
  `EngageCampaign`/`CampaignReply`/`ReplyThreadMessage` types) and `hooks/use-engage.ts` (sync→async,
  IDENTICAL return shape) changed. **No UI component touched** (git confirms). The mock `constant.ts`
  is now orphaned (left in place; safe to delete later).
- Mapping keeps the UI identical: `IN_CAMPAIGN`→`'IN CAMPAIGN'`, `NOT_INTERESTED`→`'NOT INTERESTED'`,
  `receivedAt`→relative `"2h"`, thread `header` synthesized as `SENDER → COMPANY · time`.
- Verified: the two engage files typecheck clean (the web repo has PRE-EXISTING typecheck errors in
  unrelated scaffolds — dashboard/activate/overview/reach/shell — not touched here).

## To run it end-to-end (user's stack)
1. Agent: `cd erp-agents && uvicorn erp_agents.server:app --port 8001` (needs the Hermes gateway up for live classify).
2. Backend `.env`: `AGENTS_BASE_URL=http://localhost:8001` (+ DATABASE_URL). `corepack pnpm --filter @evertrust/api start:dev`.
3. Seed: `POST /growth/engage/demo-seed` → 3 classified replies into your first campaign (no agent needed — pure DB).
4. Frontend: `corepack pnpm --filter @evertrust/web dev` → open Engage; it now renders from the DB.
5. Live agent classify: `POST /growth/engage/campaigns/:id/classify` (once the gateway is healthy).

## Deferred (next phases)
- Google OAuth (login → Gmail/Calendar): the Send + booking path. Backend should hold the per-user
  tokens (or Workspace domain-wide delegation for shared info@/hanna@) and do the sending; agent stays brain-only.
- Reply Glock feedback/rewrite (v2) behind the AI-feedback endpoint.
