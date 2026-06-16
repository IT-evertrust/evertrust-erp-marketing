# n8n → ERP strangler — architecture & roadmap

**Status:** design · decisions locked 2026-06-16 · **Governed by** the multi-tenant invariant
(`CLAUDE.md` → Core Principles, `docs/specs/multi-tenant-conversion.md`).
**Relationship to prior docs:** chooses the strangler path from `2026-06-16-replace-n8n-assessment.md` (end-state
= no n8n) and **corrects** `2026-06-16-phase3-per-org-email.md`'s provider-for-cold-send premise.

## Goal
Replace the n8n execution layer with **the ERP as the orchestration platform driving the merged
Python agents**, one stage at a time, with no flag day. End-state: n8n off (Lead Satellite possibly
last or never). Built **multi-tenant from line one** — many orgs, simultaneous and isolated, each with
its own config + credentials.

## Decisions (2026-06-16)
1. **Strangler, not big-bang.** Move one stage at a time behind the existing seam
   (`GET /campaigns/:id/config`, `POST /arsenal/runs/callback`). n8n loses one stage per step; a
   working pipeline throughout. Order: easy → hard.
2. **ERP orchestrates; Python agents are workers.** The ERP gains scheduler + queue + dispatch +
   observability and dispatches to the merged `erp-server/agents/*` services (the `AGENT_*_URL` path).
   Agents keep the already-ported stage logic (incl. the hardest piece, Lead Satellite's search). The
   agent defects from the 2026-06-16 wiring review are fixed as each stage is wired (notably:
   record-from-response replaces the broken callback model — see Tracking).
3. **Agents run on the Mac mini** beside the AI stack (LiteLLM / SearXNG / Qdrant — their hot
   dependencies). ERP→agent dispatch goes over Tailscale Funnel (same pattern as n8n-cloud→ERP today).
4. **Multi-tenant by construction.** Every schedule, queue job, dispatch, and outbound call carries
   `organizationId`; per-org config + credentials resolve `org value ?? env default`.
5. **Per-tenant credentials** (corrects Phase 3): cold send = per-tenant **`gmail.send` OAuth**
   (sensitive scope → no CASA audit); receive = **Reply-To HMAC inbound webhook** (no Gmail read
   scope); calendar = per-tenant **Cal.com EU** booking links; **Mailgun EU = transactional/opt-in
   only**, never cold first-touch.
6. **Tracking = C → A → B** (precise + visualizable) — see below.

## Prerequisite (blocks everything) — organizationId through dispatch
The agents carry **no tenant identity** today (`bazooka/server.py` RunRequest is
`{live,campaign,limit,useLlm}`; zero `organizationId` in agent code). Thread it end-to-end:
scheduler iterates **active orgs** → queue job `{ organizationId, stage, runId }` → dispatch resolves
per-org creds/config and passes org context → agent echoes `runId` back → ERP resolves the run by
**UPDATE** (not a 2nd insert). Until this lands, no per-org credential or per-org metric is possible.

## Credential model (per-tenant)
- **Cold send:** each org connects its own Google account via OAuth, **`gmail.send` scope only**
  (one-time OAuth-app verification; avoids the annual CASA security assessment that `gmail.readonly`/
  `modify` would force). Replaces the agents' per-account token files + hardcoded
  `sender_addresses {info,hanna}`.
- **Receive:** Phase 3's **Reply-To HMAC** (`reply+<hmac(prospectId.campaignId)>@inbound.<domain>`) +
  `POST /inbound/email` webhook — no Gmail read scope (keeps us out of restricted-scope/CASA).
- **Calendar:** per-tenant **Cal.com (EU, self-hosted)** booking link in org config; the single-token
  Google Calendar path stays only as a white-glove fallback.
- **Transactional/opt-in mail:** Mailgun EU (server-side key, per-domain DNS verification) — NOT cold.
- **Token storage:** per-org refresh token with envelope encryption (per-tenant data key wrapped by a
  KMS master key); never logged; `invalid_grant` → prompt re-consent (no silent retry).
- **Legal (load-bearing, get counsel):** German **UWG §7(2) No.3** requires prior express consent for
  B2B cold email — no legitimate-interest cure, fines to €300k. Per-tenant own-mailbox sending is the
  most defensible posture (customer = sender; vendor = processor + DPA); lawful basis is the customer's
  documented responsibility. Bake in consent attestation + opt-out + EU residency.

## Tracking model (C → A → B)
- **C — scope hardening (now, no-regret):** push org+time filters into SQL with a composite
  `(organizationId, stage, createdAt)` index (today reads full-table scan); add `organizationId` to
  `embeddings` (current cross-tenant RAG leak); replace null-org "global" runs with an explicit
  **PLATFORM-org sentinel**; soft-archive instead of hard-delete.
- **A — run identity + idempotent outcome (before any 2nd tenant runs live):** one `runId` per run
  with a state machine, resolved by **UPDATE** keyed on a `runId` the agents echo back, plus an
  `idempotencyKey` unique constraint (kills the double-/triple-write) and a timeout sweeper for
  never-resolving runs. Makes `totalRuns`/`successRate`/funnel honest. This **is** the
  record-from-response model.
- **B — event model + per-org rollups (platform Phase 2):** append-only per-`(org,stage,run)` events
  → incrementally-maintained per-`(org,stage,day)` rollups, so per-org dashboards (funnel
  leadsFound→emailsSent→repliesHandled→meetingsBooked; per-stage success/error/latency; per-org AI
  spend from `ai_runs.eurCost`) + an OWNER cross-org grid read pre-aggregated rows at constant cost.

## Sub-project roadmap (each = own spec → plan → build → flip its n8n stage off)
0. **Foundation** — organizationId-through-dispatch + tracking **C + A**. Folds into #1.
1. **Platform + Sleeper pilot** — scheduler (`@nestjs/schedule`, per-org) + queue (BullMQ on a
   Render-reachable Redis) + dispatch + record-from-response; migrate **Sleeper Grenade** (its n8n PG
   workflow is already inactive → no parallel-run risk). Builds the reusable muscle. ~2–3 wks.
2. **Per-tenant send/receive creds** — `gmail.send` OAuth connect flow + encrypted token vault +
   `POST /outreach/send` seam (From validated against a verified org sender) + Reply-To inbound
   webhook + Cal.com link in org config. Gates live multi-tenant for Bazooka/Glock.
3. **Reach Bazooka** — daily send loop on the platform via `/outreach/send`. Flip Bazooka off in n8n.
4. **Reply Glock** — reply classify + graduate + Cal.com booking; consumes the inbound webhook. Flip off.
5. **Ammo Forge / Niche Analytics + AIM orchestration** — LLM generation + the campaign-deploy fan-out
   moves into the ERP dispatcher. Flip off.
6. **Lead Satellite** — *last / optional* — the agentic web-search extraction (highest risk). Migrate
   only if a driver demands it; otherwise it stays on n8n permanently.

## First sub-project — Platform + Sleeper pilot (detail)
**Pattern (reused by every later stage):**
`ERP cron (per active org) → enqueue {org,stage,runId} (BullMQ) → worker → POST agent /sleeper/run on
the mini (org context) → agent runs the snooze-due sweep (LiteLLM draft → send → write
outreach/suppressions to ERP) → returns a structured result → worker resolves the run by UPDATE
(SUCCESS/FAILED + metrics) on the (org,stage,runId) row.`
- **Org-scoped:** scheduler iterates active orgs; every job carries `organizationId`; `arsenal_runs`
  written per-org.
- **Precise (tracking C+A baked in):** runId + idempotencyKey + state machine; no separate callback.
- **Agent fix folded in:** wrap Sleeper's per-prospect send so one failure can't abort the sweep;
  return structured counts.
- **Out of scope (YAGNI):** the email-provider/OAuth send seam (that's sub-project #2) — for the pilot
  Sleeper keeps its existing send for the single current org; the pilot is org-aware in *orchestration*
  even while only one org has credentials.
- **Infra adds:** a Redis reachable from Render (Render Key Value) for BullMQ; the agents deployed on
  the mini with `AGENT_SLEEPER_GRENADE_URL` = the mini's Funnel URL.
- **Testing:** API jest (scheduler enqueues; worker resolves SUCCESS/FAILED; retry path, mocked agent);
  agent pytest (per-item guard + structured result); manual E2E — a dry-run "Run now" (assert one
  `arsenal_runs` row, zero sends), then one capped live run.

## References
- `docs/specs/multi-tenant-conversion.md` (§9 = orchestration platform, org-scoped)
- `docs/specs/2026-06-16-replace-n8n-assessment.md` (replacement map + strangler order)
- `docs/specs/2026-06-16-phase3-per-org-email.md` (per-org send/receive seam, corrected for cold)
- 2026-06-16 agent-wiring review (the agent defects fixed as each stage is wired)
