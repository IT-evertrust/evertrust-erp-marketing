# tasks/todo.md

Working plan for this repo, per CLAUDE.md Task Management:

1. Write the plan here as checkable items **before** implementing.
2. Check in on the plan before starting non-trivial work.
3. Mark items complete (`[x]`) as you go; move finished items to **Done**.
4. Add a summary of what changed and how it was verified to **Review** when a chunk of work lands.

Backlog items below are seeded only from verified defects in the current codebase.

---

## Current Focus

**Growth Engine: Drive/Sheets → Supabase Postgres (cloud stack: Supabase DB + Render API + Vercel web)** (design approved in-session 2026-06-12; 8 new tables + notifications, 3 modified, 7 new enums):

User requirements (2026-06-12):
1. Data must match workflows one way or the other (contract parity + reconciliation)
2. Remove Target field from AIM — UI/UX included (state→region rename too)
3. New workflow NICHE ANALYTICS: find targets, analyze, produce a file, auto-trigger Lead Satellite when done
4. Lead Satellite must NOT search companies without the niche analysis existing (gate)
5. Replace Drive/Sheets nodes with Supabase Postgres (via Render API + ARSENAL_INGEST_TOKEN) wherever replaceable
6. Optional: n8n→ERP notification webhook with UI animation

Phase 0 (repo, this session):
- [x] packages/db: 7 new enums + niches/niche_targets/prospects/suppressions/outreach_messages/reply_classifications/campaign_assets/contracts/notifications; campaigns (nicheId NN, state→region, +sender, status→lifecycle, deployedBy/At→activatedBy/At, +archivedAt, drop niche/target/status/driveMissing/driveCheckedAt/deployError); leads (+nicheId fallback, drop niche); arsenal_runs (+configSnapshot); migration 0019 with hand-added backfills
- [x] erp-server: machine guard reusing ARSENAL_INGEST_TOKEN on n8n-facing routes; GET /campaigns?lifecycle + GET /campaigns/:id/config + POST /prospects/bulk + GET/PATCH /prospects + GET /niches + POST /niches/:id/targets/bulk + POST /reply-classifications + POST /suppressions + POST /campaigns/:id/assets + POST /contracts + POST/GET notifications; campaigns module rework (niche find-or-create, lifecycle, sender, campaignId in AIM payload; remove /campaigns/sync reconcile)
- [x] erp-client: AIM form (Target removed, State→Region, +sender, niche pick-or-create) + notification bell with animation
  - [x] Reconcile: deleted src/lib/api-contracts.ts; api.ts now imports Campaign/Niche/Notification DTOs + UpdateCampaignLifecycleDto from @evertrust/shared; consumers read c.nicheName/region/lifecycle (no campaignNicheName helper needed — shared CampaignDto.nicheName is a joined field). One source of truth.
  - [x] use-campaigns: useSetCampaignLifecycle (optimistic list+detail patch, rollback); use-niches (lazy); use-notifications: poll 30s + markRead + markAllRead (optimistic). query-keys already had campaigns/niches/notifications.
  - [x] AIM dialog: dropped Target, State→Region (Select on CAMPAIGN_REGIONS), niche Input+datalist from /niches with new-niche hint, Sender alias Select (info/hanna default info), payload = exact CreateCampaignDto, toast on returned lifecycle
  - [x] campaign-board + marketing-campaigns + dashboard donut/tiles + sidebar live-count: lifecycle badge (CAMPAIGN_LIFECYCLE_BADGE, 4 states) + nicheName/region; arsenal-sequence aimStatus from lifecycle; Pause/Resume/Archive dropdown on board; removed FAILED/deployError UI (no longer in contract)
  - [x] key-account: dropped lead.niche (shared LeadDto now nicheId-only, no joined name) from search/detail/card
  - [x] notification-bell in topbar (Bell + unread badge, one-shot shake+pop on increase, reduced-motion safe, DropdownMenu list, Mark all read, "Nothing new" empty); globals.css keyframes registered in @theme
  - [x] typecheck GREEN (corepack pnpm --filter @evertrust/web typecheck); lint clean (only pre-existing exhaustive-deps warnings, none in touched/new files)
- [x] pnpm typecheck + API jest green (workspace typecheck 4/4; API 38 suites / 317 tests)
- [x] FIX: region reverted from a compass enum (agent over-reach) back to FREE TEXT to match the Lead Satellite city-expansion (req #1); sender kept as enum (info/hanna = real Gmail creds)
Phase 1 (n8n, this session, created INACTIVE):
- [x] NICHE ANALYTICS workflow [jgOVy4Ox9fCtpT7S, INACTIVE] (webhook → GET config → AI target expansion → POST targets → analysis doc + POST assets → POST notify → trigger Lead Satellite)
- [x] LEAD SATELLITE copy 6 [dCGzrlpaxpxJanbJ, INACTIVE] via generator extension (gate: no targets → trigger NICHE ANALYTICS + stop; config via API; prospects bulk dual-write)
- [x] AIM v2 (PG) [QDvotfZeo03bZy7m, INACTIVE] — 3 Drive nodes removed, {campaignId} payloads; original AIM untouched

USER follow-ups before the new workflows can run (the ERP endpoints go live only after the backend deploys):
- [ ] Create n8n Header Auth credential "ERP Ingest (x-arsenal-token)" (header x-arsenal-token = ARSENAL_INGEST_TOKEN) and select it on the UNBOUND ERP HTTP nodes — NICHE ANALYTICS (POST Bulk Targets / POST Campaign Asset / POST Notification) and LEAD SATELLITE copy 6 (Fetch Config / POST prospects-bulk / POST runs-callback)
- [ ] copy 6: bind web_search to the SearXNG cred (Header Auth account 3) + spot-check the 6 auto-assigned Google creds
- [ ] Set ARSENAL_INGEST_TOKEN on Render; commit + push + redeploy the API; point ERP Lock & Load at aim-deploy-campaign-v2; review + activate in cutover order (AIM v2 → NICHE ANALYTICS → copy 6)
Phase 2 (n8n rebuilds — DONE this session, all INACTIVE, originals untouched):
- [x] Backend gap endpoints: POST/GET /outreach-messages, GET /reply-classifications?needsRag, POST /prospects/:id/graduate, GET /contracts (API 40 suites / 329 tests green)
- [x] RAG AGENT (PG) [ffd3c2uRgkMLFaxT] — needsRag backlog → thread → gpt-4o draft → POST reply-classifications. DECISION (2026-06-12): grounding stays THREAD-ONLY for launch — drafts are human-reviewed in the ERP queue so gaps get caught; the original's Drive knowledge-file grounding is NOT restored (re-coupling to Drive). Proper fix = wire Qdrant retrieval (ai-stack already has Qdrant + a KB INGEST workflow) — tracked as a Phase-3 enhancement, not a Drive-file restore. OpenAI cred needs manual bind.
- [x] REPLY GLOCK (PG) [gQeWiDlDRuF1r3tt] — OVER-PRUNED (16 nodes; dropped 55 of the original 71 — the whole meeting-booking + WhatsApp + error subtrees). SUPERSEDED by v2 below; DELETE gQeWiDlDRuF1r3tt.
- [x] REPLY GLOCK (PG) v2 [5QkBzSzK1UdxiE96, INACTIVE] — faithful clone of live Vi9x1RhdRIaePZPQ, 77 nodes. ONLY lead-data nodes swapped to ERP (GET /prospects?email=, POST /reply-classifications per verdict, POST /prospects/:id/graduate on INTERESTED, POST /outreach-messages INBOUND). PRESERVES the entire meeting-booking flow (Calendar find-slots/check/create + slot-proposal + confirmation emails), ALL WhatsApp notifies, the AI-agent subtree, and the error handler. ADDS POST /notifications alongside every WhatsApp (both channels per user). DROPS only the unsure auto-reply (→ RAG draft queue, per user). 15 ERP nodes UNBOUND → bind "ERP Ingest". Code at tasks/reply-glock-pg-v2.workflow.ts.
- [x] SLEEPER GRENADE (PG) [cZDGIoudM6yg17kV] — snoozeDue scan → AI re-engage → WhatsApp approve → send → RE_ENGAGED; DNC → suppression + status flip (no row delete). CAVEAT: ADDS AI/Gmail/WhatsApp-approve that the live 4GgPmoulQDgDWtej lacked (matches the workflow's described intent, but review); DNC tests a `doNotContact` flag — confirm vs real prospect signal.
- [x] REACH BAZOOKA (PG) [W5jsrD1DFQfYYmig] — INACTIVE + DANGER sticky + send-cap 25/run. sendList → validate/personalize → Gmail (info@/hanna@ branch) → log outreach + PATCH EMAILED → runs/callback. CAVEAT: both Gmail nodes auto-bound to ONE cred — REASSIGN the Hanna/info@ split before any run. SUPERSEDED by v2 below (over-pruned: dropped the WhatsApp layer + error handler).
- [x] REACH BAZOOKA (PG) v2 [zyCTVLpZj3YyR2qV, INACTIVE, project REACH ARSENAL] — faithful clone of live qVvT6WLTYxtfubUg (NOT the pruned W5jsrD1DFQfYYmig). 59 nodes. ONLY lead-data nodes swapped to ERP (machine/list, /config, sendList, PATCH prospect, POST outreach-messages SENT/FAILED, runs/callback). PRESERVES the full WhatsApp layer (Run Start / Campaign Activated / Missing File / Outbound Summary + builders/IFs), the error-handler subtree (On Workflow Error → Config Error Globals → Code Format Error Message → WA Error Alert), the LLM validate/personalize step, and the Gmail Hanna/info split bound to the TWO DISTINCT creds by id (Hanna iBJ8BCOqhFb5kDUg, info 4oGndbIXYKoqNask — create response autoAssignedCredentials:[] confirms no collapse). ADDS a global send-cap guard (default 25 via $vars.BAZOOKA_MAX_SENDS) + POST /notifications alongside all 5 WA pings. KEEPS Drive templates.doc + news-info (content, not lead data). FIRST attempt KnAiuqSzhzMYkegE had the Gmail split collapsed onto one cred (newCredential w/o id) — USER SHOULD DELETE KnAiuqSzhzMYkegE; the keeper is zyCTVLpZj3YyR2qV. 13 ERP HTTP nodes UNBOUND → select "ERP Ingest (x-arsenal-token)" before any run. Code at tasks/reach-bazooka-pg-v2.workflow.js.
- [x] ContractMaker (PG) [wZWcjzx7fSbbsT7c, project ur8aLn8JmnpaN0ih] — ERP campaign match + contract idempotency + POST/PATCH contracts; KEEPS Drive/Docs PDF gen. CAVEAT: leadId/customerId not in Read.ai payload (passed through if present); Google creds need Hanna reassignment; Signal/Deal models → LiteLLM gateway.

Over-pruning audit + correction (2026-06-12, user caught it on REPLY GLOCK):
- Root cause: my first rebuild prompts described each workflow as just its "data spine", so agents pruned all non-data subtrees (calendar booking, WhatsApp, error handling) as "out of scope". Correct method = clone the ORIGINAL, swap ONLY lead-data nodes.
- Audited all 6 rebuilds vs originals: only REPLY GLOCK + BAZOOKA had real regressions (both fixed → v2). SLEEPER / ContractMaker / AIM v2 / copy 6 are CLEAN (features preserved). RAG = thread-only grounding decision above.
- [ ] USER CLEANUP — delete the 3 superseded INACTIVE workflows: gQeWiDlDRuF1r3tt (REPLY GLOCK pruned), W5jsrD1DFQfYYmig (BAZOOKA pruned), KnAiuqSzhzMYkegE (BAZOOKA v2 first attempt, Gmail cred collapsed). Keepers: 5QkBzSzK1UdxiE96 + zyCTVLpZj3YyR2qV.

Phase 2b (JWT UI read/management layer for Growth-Engine entities — this session):
Goal: the ERP web UI can fully operate prospects/contracts/outreach/niche-targets with a JWT.
Today those 3 controllers are CLASS-level @Public + ArsenalTokenGuard (machine-only). Refactor to
METHOD-level @Public on each machine route (the campaigns.controller pattern) so JWT routes coexist.
JWT routes are ORG-SCOPED via req.user.organizationId; machine routes keep deriving org from the entity.
Path-collision rule: keep the exact machine paths n8n already calls; add a sibling sub-path for the JWT list.
- [x] shared DTOs: ProspectListDto, UpdateProspectStatusDto, NicheListItemDto (counts), CreateNicheTargetDto, UpdateNicheTargetDto, ReplyDraftDto (review-queue), SuppressionListItemDto. NicheTargetDto/ProspectDto/ContractDto/OutreachMessageDto reused. Exported from the barrel.
- [x] prospects: kept machine GET /prospects (sendList/snoozeDue/email) + machine PATCH /prospects/:id (now METHOD-level @Public); add JWT GET /prospects/board (org list+statusCounts), GET /prospects/:id/detail, PATCH /prospects/:id/status
- [x] niches: enriched JWT GET /niches → NicheListItemDto (targetCount+campaignCount, superset of combobox); add JWT GET /niches/:id/targets, POST /niches/:id/targets (MANUAL); new NicheTargetsController for PATCH+DELETE /niche-targets/:id (org via parent niche)
- [x] contracts: kept machine GET /contracts + POST + PATCH :id (METHOD-level @Public); add JWT GET /contracts/list (org-scoped)
- [x] outreach: kept machine GET /reply-classifications?needsRag + GET /outreach-messages + POST /suppressions (METHOD-level @Public); add JWT GET /reply-classifications/queue, GET /outreach-messages/thread, GET /suppressions, DELETE /suppressions/:id
- [x] tests: +5 specs (board org-scoping, niche-target PATCH+cross-org 404, reply-draft queue suggestedReply-only, suppression list+delete, outreach thread org-scoping). ALL suites green.
- [x] verify: shared typecheck GREEN; api typecheck+build GREEN; api jest 45 suites / 355 tests GREEN (was 40/329)

Phase 2c (full Growth-Engine web UI — fully wired, this session):
- [x] Plumbing: api.ts client fns + query-keys + growth-format.ts + optimistic hooks (prospects board/detail/status, niche targets CRUD, reply drafts, contracts, suppressions, outreach thread)
- [x] Campaign detail route /marketing/[campaignId] — Overview (lifecycle + Pause/Resume/Archive, niche/region/sender) / Targets (enable-disable Switch + inline edit + add MANUAL + delete) / Prospects (board, statusCounts chips, filter/search/paginate, row status override, detail drawer) / Contracts tabs
- [x] New pages: /marketing/niches (list w/ counts → targets mgmt), /marketing/drafts (RAG review queue + thread + copy), /marketing/suppressions (list + un-suppress); nav entries under Acquisition (campaigns:read)
- [x] Reusable: outreach-thread, niche-targets, prospects-board, prospect-detail-drawer, contracts-card; lead-detail-dialog shows the lead's contracts
- [x] FIX: contracts client was pointed at machine GET /contracts (would 401 in a browser session) → repointed to JWT GET /contracts/list
- [x] verify: workspace typecheck 4/4 GREEN; web lint zero new errors; dead-button audit clean (every action → real endpoint + query invalidation; no TODO/mock/dead handler)

Pre-deploy review (12-agent diff, this session) — deploy-critical = CLEAN:
- [x] Migration 0019 audited: transaction-safe (drizzle wraps the file; mid-migration failure rolls back), backfills precede SET NOT NULL + drops, 'uncategorized' fallback covers every campaign, real RENAMEs, fresh-DB safe, vector extension untouched.
- [x] Tenancy: all 13 JWT routes filter by req.user.organizationId (no cross-org leak); ArsenalTokenGuard constant-time + 503/401. Frontend↔backend: all 16 client URLs match routes (the /contracts→/contracts/list seam was the only mismatch — fixed).
- [x] BLOCKER FIXED: erp-server/.env.example (working-tree ONLY, never committed — HEAD has blanks) had real ARSENAL_INGEST_TOKEN + N8N_API_KEY → blanked back to placeholders.
- [x] M1 FIXED: niche-target rename slug-collision now returns 409 (was a raw 500). N1 SKIPPED deliberately — the bell is a GLOBAL feed; gating GET /notifications behind campaigns:read would hide it from non-marketing roles. M2 (fetch-then-filter on draft/board reads) deferred — fine at cutover volume, push to SQL when it grows.
- [ ] **USER (security): ROTATE both secrets** — they sat in the tracked template's working tree + surfaced in this session. Mint a new ARSENAL_INGEST_TOKEN (set on Render + the n8n ERP-Ingest cred + vault) and revoke/reissue the n8n cloud API key. The repo was never pushed with them, but rotate to be safe.

Phase 3 (cutover — next sessions, needs the API deployed first):
- [ ] Bind "ERP Ingest (x-arsenal-token)" Header Auth cred on every ERP node across all 9 new workflows; apply the per-workflow cred fixes above
- [x] One-time DATA BACKFILL workflow built [XFxlPdyRfTyO6KX9, INACTIVE]: per ACTIVE campaign → find leads sheet in its Drive folder → POST /prospects/bulk (+ /suppressions for DNC); idempotent upsert + reconciliation tally. CAVEAT: hot_leads NOT migrated (POST /leads/backfill is JWT-only/no-body — trigger the existing ERP UI import separately). Run supervised at cutover.
- [ ] Activate in cutover order, verify, then retire originals (AIM, Lead Satellite copies, RAG, Glock, Sleeper, Bazooka, ContractMaker, CRM Hot Leads, CRM Customer, CAMPAIGNS LIST, NICHE FLAMETHROWER)
- [ ] Migration 0020 (destructive column/enum cleanup) + remove Drive/Sheets creds + docs (08-workflow-canonical.md, lessons.md)

---

**ERP migration: evertrust-ERP → this repo + hosting to the Mac mini** (plan approved 2026-06-11,
`~/.claude/plans/breezy-knitting-koala.md`; retires Render/Vercel):

- [x] Preflight: both repos main == origin/main; SearXNG baseline committed (8147d72).
- [x] Monorepo imported on branch `migrate-evertrust-erp`: apps/api→`erp-server/`, apps/web→`erp-client/`, `packages/{db,shared}`, root workspace files, infra Dockerfiles; boilerplate (Prisma/TypeORM hello-world + create-next-app) deleted; path rewrites applied; pnpm-lock importer keys regenerated (`--frozen-lockfile` verified).
- [x] VERIFIED on the mini: `pnpm run build` ✅, `typecheck` (4 pkgs) ✅, `lint` ✅, `test` 35 suites / 299 tests ✅; Docker images build green (`evertrust-api:prod` 2.13GB, `evertrust-web:prod` 486MB, NEXT_PUBLIC_API_URL=tailnet host baked).
- [x] New `erp-server/docker-compose.yml`: postgres → `pgvector/pgvector:pg18` (new volume `postgres_data_pg18`), + `erp-api` (3001) + `erp-web` (3000) services; consolidated `.env.example` matching `src/config/env.schema.ts`.
- [x] Docs swept: CLAUDE.md rewritten (monorepo/Drizzle/pnpm), team-hosting.md (ERP on the mini, funnel `/erp` path), drizzle-database agent replaces prisma-database, /db-migrate + /dev-up rewritten.
- [x] Postgres image swap DONE (2026-06-11): pgvector/pgvector:pg18 (PG 18.4, vector 0.8.2, arm64) on new volume `postgres_data_pg18`; dump at `~/erp-pg-migration/alpine-all-2026-06-11.sql` (22 MB, DBs evertrust-erp + litellm, roles intact); restored + verified (litellm 62 tables, virtual key present); ai-stack healthy again (litellm needed `--force-recreate` — stale network ID); 401-keyless verified on gateway/Qdrant/SearXNG. Old alpine volume `erp-server_postgres_data` kept until verified.
- [x] Docker Desktop VM cap raised 3 GB → 4.5 GB (settings-store.json MemoryMiB=4608, Docker restarted, confirmed 4.63 GB).
- [x] Container boot checks: web image serves /login (HTTP 200) standalone; api image has dist/main.js + api-start.sh + curl + tsx; NODE_ENV=production set for erp-api (logger transport).
- [x] DRESS REHEARSAL GREEN (2026-06-11 ~18:15, zero downtime — Render/Vercel untouched): precut dump from Render (`~/erp-pg-migration/render-precut-2026-06-11-1808.dump`, 28 tables + drizzle journal + pgvector) restored as `evertrust` (1 org, 3 users, 2 tenders, 26 campaigns, 2 leads, 5 meetings); `.env` assembled via `~/erp-pg-migration/setup-env.sh` (secrets never in agent context); `docker compose up -d --build` → all 3 containers healthy; boot-time migrate applied 0018 (19 in journal, kpi_definitions exists), production seed-gate SKIPPED the dev seed as designed; smoke: /health db:true, /login 200 local+tailnet, bad-creds 401, CORS preflight 204.
- [x] Funnel `/erp` LIVE + path-strip VERIFIED: `https://mac-mini-ca-mac.tailc3d837.ts.net/erp/health` → 200 over public HTTPS; gateway `/v1` still 401-keyless. No global prefix needed.
- [ ] **USER: browser login test** at http://mac-mini-ca-mac.tailc3d837.ts.net:3000 with real credentials (restored from Render); open a tender, upload a doc.
- [x] `.env` complete (2026-06-11): N8N_API_URL/KEY + ARSENAL_INGEST_TOKEN live (callback endpoint answers 400 not 503 = token loaded); 7 `N8N_*_WEBHOOK_URL`s filled from a 25-workflow MCP sweep (AIM aim-deploy-campaign, campaigns-list, lead-satellite wf03-lead-research, ammo-forge wf4, sleeper wf8, provision-hot-leads, crm-customer). BAZOOKA/REPLY GLOCK have no webhook trigger (schedule-only) and HERMES RFQ workflow doesn't exist → those stay blank by design. ANTHROPIC_API_KEY still blank (price-assist off until set).
- [x] CUTOVER DONE (2026-06-11 ~18:43): final Render dump (`render-final-2026-06-11-1839.dump`) → drop/recreate `evertrust` → restore (1 org / 3 users / 2 tenders / 26 campaigns / 2 leads / 5 meetings / 142 audit rows) → stack up healthy → re-smoke green (health db:true, funnel /erp/health 200, /login 200). Merged to main (1a28a8f + cutover commits) and pushed.
- [x] n8n cloud sweep (25 workflows, MCP): **zero `onrender.com` references** — the run-callback was never wired in cloud workflows, so nothing to repoint. When the callback writeback gets built, use `https://mac-mini-ca-mac.tailc3d837.ts.net/erp/arsenal/runs/callback` + x-arsenal-token.
- [x] TEARDOWN DONE (2026-06-11 ~20:00, user): Render `evertrust-api` + `evertrust-db` deleted (verified: DB host refuses connections, onrender URL 404s), Vercel project deleted, `Ryugwki/evertrust-ERP` archived. Post-teardown verify: mini stack all healthy (api db:true, web 200, funnel /erp 200, ai-stack untouched). **MIGRATION COMPLETE.** Recovery dumps retained in `~/erp-pg-migration/` + nightly backup path; old alpine Postgres volume still on disk (delete after a quiet week or two).
- [ ] **USER: rotate exposed-in-chat secrets** (when convenient): n8n API key (cloud → Settings → API), re-mint JWT_SECRET, change the DB password (= username today; ties into the Postgres-consolidation backlog item).
- [ ] First real end-to-end: launch/sync a campaign from the ERP UI (fires the n8n webhooks live); add Webhook triggers to BAZOOKA/REPLY GLOCK in n8n if their "Run now" buttons are wanted.

**AI backend (Hermes gateway) + n8n-cloud migration** (plan approved 2026-06-10; mini side DEPLOYED):

- [x] Local n8n retired (containers removed, volumes kept); `erp-server/docker-compose.yml` = postgres only.
- [x] `ai-stack/` deployed on the mini: LiteLLM gateway (healthy, virtual key minted → `~/.evertrust/n8n-virtual-key.json`), Redis cache, Qdrant (API-key enforced). litellm DB rides erp-postgres via the shared docker network (host.docker.internal is shadowed by brew postgres — see Backlog).
- [x] Gateway smoke-tested: `/v1/models` lists all 5 aliases; `hermes` chat completion returns through the mini's Ollama; Qdrant 401s without key.
- [x] Ollama tuned (KEEP_ALIVE 5m, flash attention, q8 KV) via LaunchAgent + live setenv.
- [x] Funnel LIVE (2026-06-10): gateway at https://mac-mini-ca-mac.tailc3d837.ts.net (443) and Qdrant (:8443), both verified over public HTTPS with auth enforced (401 keyless). Let's Encrypt cert to Sep 2026.
- [x] pmset applied (sleep 0, autorestart) and Docker VM capped at ~3 GB.
- [ ] **USER: vault** — store `ai-stack/.env` values + the n8n virtual key (`~/.evertrust/n8n-virtual-key.json`).
- [ ] **USER: disable key expiry** on mac-mini-ca-mac + evertrusts-macbook-pro (admin console → Machines).
- [ ] **USER: n8n credentials** (browser, evertrustgmbh.app.n8n.cloud, in BOTH projects): OpenAI credential `LiteLLM Gateway (mac-mini)` (key from the virtual-key file, Base URL https://mac-mini-ca-mac.tailc3d837.ts.net/v1) + Qdrant credential `Qdrant (mac-mini)` (https://mac-mini-ca-mac.tailc3d837.ts.net:8443, QDRANT_API_KEY).
- [x] Team on the tailnet (2026-06-10): mac-mini-ca-mac, evertrusts-macbook-pro (Trev/Khanh, 100.93.32.103), lams-macbook-air, iphone-15-pro-max. `TAILNET_OLLAMA` wired to Trev's address; gateway recreated; **fallback chain verified live** (primary dark → mini's hermes3:8b answered).
- [x] TREV LIVE (2026-06-10): his Ollama serves on the tailnet — 5 models (hermes3:8b, deepseek-r1:14b, deepseek-r1:32b, qwen3:8b, nomic-embed-text). Verified through the gateway: `hermes` answered in 1.9 s (vs 60–190 s mini fallback), `deepseek` works.
- [ ] **Phase-4 constraint discovered**: deepseek-r1 is a reasoning model — with low max_tokens the `content` comes back EMPTY (all budget eaten by `reasoning_content`) → would break JSON-parsing nodes. Any node routed to `deepseek` needs max_tokens ≥ ~1500. Alternative to evaluate in the harness: Trev's `qwen3:8b` (supports /no_think) or `deepseek-r1:32b` for quality.
- [ ] Docker Desktop was found QUIT today (whole stack down until restarted) — confirm "Start Docker Desktop when you sign in" is enabled on the mini and tell the team not to quit it.
- [ ] **USER: disable key expiry** for evertrusts-macbook-pro AND mac-mini-ca-mac (admin console → Machines; his key expires in 5 months).
- [x] n8n Phase 2 (2026-06-10): credentials live in REACH ARSENAL (`LiteLLM Gateway (mac-mini)` 2YgDmy9NuLHvOgzJ, Qdrant xaNvwRlsTzu5aF55 — both verified hitting the mini); REACH BAZOOKA test (znawhBKUhRZSlMUq) swapped to `hermes` (3 nodes, byte-diff verified, inactive); LLM AB HARNESS created (BXmnU6ylSBmQ5maz, 15 nodes, inactive).
- [ ] **USER: first harness run** — open LLM AB HARNESS: run "Create Results Sheet" once → paste the returned URL into "Results Config" → click "Run AB Test" → review LLM_AB_Results sheet. This also behaviorally verifies all 3 credential bindings (the n8n API redacts them, so machine verification was impossible).
- [ ] Gateway credential still needed in Trung's personal project before migrating personal-project workflows (n8n creds are project-scoped).
- [ ] INVESTIGATE: production REPLY GLOCK's "OpenAI — Classify Reply" node already has modelId set to `deepseek` (someone changed it manually) — confirm which credential it uses; if it's still the OpenAI credential, that node is broken.
- [ ] n8n cloud Phase 3: KB INGEST workflow + RAG AGENT rework (retrieval first, model second; update IN PLACE — dedup state).
- [ ] n8n cloud Phase 4: tiered node migration per plan (P1 hermes, P2 deepseek, P3 ContractMaker last; web-search + German template nodes stay OpenAI).
- [ ] Verify cache hit-rate behavior on repeated identical calls (cache key header present; hit timing not yet confirmed).
- [ ] Set up the nightly backup job (docs §8) once an external SSD is attached.

**WF-03 LEAD SATELLITE copy 3 — implement real web search on the self-hosted gateway** (plan drafted 2026-06-10; backend choice pending):

Context: the 3 "(Web)" nodes (`Country Profiler (Web)`, `Search Companies (Web)`, `Find Missing Emails (Web)`) rely on the OpenAI node's `builtInTools.webSearch` — a **hosted** tool that only executes on OpenAI's servers. Pointing those nodes at the LiteLLM gateway silently removes all search ability (this is why Phase 4 said "web-search nodes stay OpenAI"). To migrate them, the search loop must run n8n-side: AI Agent node + Chat Model sub-node (gateway) + search tool sub-node.

- [x] **DECISION (user, 2026-06-10)**: SearXNG self-hosted on the mini.
- [x] SearXNG DEPLOYED (2026-06-10): `ai-searxng` (pinned 2026.6.8, no published port, google/startpage engines off) + `ai-searxng-auth` Caddy proxy enforcing `X-Search-Key` (127.0.0.1:8088) in `ai-stack/docker-compose.yml`; funneled at https://mac-mini-ca-mac.tailc3d837.ts.net:10000. Verified: keyless → 401 (local + public), keyed German trade queries → 27–30 JSON results. Secrets `SEARXNG_SECRET`/`SEARXNG_API_KEY` appended to `ai-stack/.env`; `.env.example` + docs/team-hosting.md updated.
- [ ] **USER: vault** — add `SEARXNG_SECRET` + `SEARXNG_API_KEY` (from `ai-stack/.env` on the mini) to the team vault.
- [x] Agent rewiring DONE as **copy 4** (2026-06-11): copy 3 had diverged (32 nodes, company search fanned out to child workflow `WF-03 Segment Worker` via webhook + `wf3_segment_results` data table; only `Country Profiler (Web)` + `Find Missing Emails (Web)` remained as openAi/hosted-webSearch nodes). Both replaced with AI Agent nodes (same names — `$('...')` refs intact) + hermes chat-model sub-nodes (gateway cred bound by ID, Responses API off, temp/maxTokens carried over) + ONE shared `web_search` httpRequestTool (GET …:10000/search, q from AI, format=json, response optimized to results[].title/url/content). Downstream parsers needed NO changes (they already try `output`-as-string first). SDK code generated programmatically (`tasks/wf03-copy3-gen.py` → `tasks/wf03-copy3.sdk.js`, 88KB), validated (35 nodes), created as `tNEr0hgMOLvCs03Y` in REACH ARSENAL. NOTE: `update_workflow` on copy 3 was blocked by an MCP schema mismatch (live server wants an undocumented `operations` array) — hence create-as-copy-4; copy 3 left untouched as reference.
- [x] VERIFIED: hermes3:8b through the gateway returns proper `tool_calls` (`finish_reason: tool_calls`, called web_search with a sane query) — the agent loop assumption holds.
- [ ] **USER: n8n credential** — the Header Auth cred you created sits in your PERSONAL project (only "Header Auth account 1/2/3" exist there; REACH ARSENAL has none). Create it again INSIDE REACH ARSENAL (Credentials → New → Header Auth: name `SearXNG (mac-mini)`, header `X-Search-Key`, value = `SEARXNG_API_KEY` from ai-stack/.env), then open copy 4 → `web_search` node → select it.
- [ ] **USER: check Google creds in copy 4** — auto-assign picked personal-project "Google Drive OAuth2 API"/"Google Sheets OAuth2 API"; if the 6 Drive/Sheets nodes show credential warnings, switch them to the ": Hanna" team creds.
- [ ] **USER: enable "Available in MCP"** on `WF-03 Segment Worker (fan-out child)` (`mW1FZfk7OaM1utBS`, ACTIVE) — it does the heavy company search (the DEEPSEEK node from the screenshot) and still uses hosted webSearch; same agent+SearXNG rewiring needed there next.
- [x] DIAGNOSED copy 4 manual-run failure (2026-06-11, execution 5399): `Decide: Should Hunt?` dies at exactly 60s with "Unknown error". Root cause: `$('Parse Webhook Body').item` referenced on a path where that node never executed — n8n cloud's external Code-node task runner resolves node references OUTSIDE the user script, so the in-code try/catch can't catch it; the data request hangs and the 60s runner timeout kills the task. Fix: pull meta from `$('Valid Payload?').first()` (executes on BOTH entry paths). Patched in `tasks/wf03-copy3-gen.py` + regenerated `wf03-copy3.sdk.js`; copy 4 itself needs the manual paste (MCP update_workflow still schema-broken).
- [ ] **USER: paste the fixed code** into `Decide: Should Hunt?` in copy 4 (snippet provided in chat 2026-06-11).
- [ ] **WARNING — same bug is LIVE in the ACTIVE original LEAD SATELLITE (and copy 3)**: every Drive-poll-triggered run takes the path where `Parse Webhook Body` never executes → same 60s hang in `Decide: Should Hunt?`. Apply the same paste-fix to the original (its drive-triggered hunts are silently failing).
- [x] **FIRST END-TO-END SEAR RUN SUCCEEDED** (2026-06-11, execution 5405, 6m18s, POLAND CS 2027 / Cyber security): Drive-trigger test → config → static PL profile → Build Search Query (after `.item`→`.first()` paste-fix + region "Warszawa, Kraków" + maxToolCalls 20 in config.json) → fan-out to segment worker → parse/validate → leads sheet created + rows appended (sheet 1UVC-Qv8DqcWVsDbnuRcUXYe90wDx5eBTsnAcJA7XveM). CORRECTION (deep-dive): email recovery contributed NOTHING — BOTH chunks 502'd (the run overlapped the ai-stack teardown for the postgres swap; gateway back at 09:58:34, run ended 09:58:24) and `web_search` has never been invoked by any execution yet → the SearXNG credential binding on the web_search node is STILL UNVERIFIED.
- [ ] **USER: spot-check the leads sheet** — CONFIRMED degraded (exec 5405 analysis): the old segment worker (DEEPSEEK, hosted webSearch non-functional on the gateway) returned `{"leads":[]}` for **92 of 111 segments** and only 28 memory-derived leads total (max 3/segment, ~2s/segment = zero actual searching); validation kept 15. The fan-out itself worked perfectly (111 segments, 81 PL cities, all done in 3.2 min). Lead volume/authenticity is blocked ONLY on the worker rewiring.
- [x] **Segment Worker REWIRED (2026-06-11)**: `WF-03 Segment Worker (SEAR)` created (`UebAXjL0VFE7maXG`, REACH ARSENAL, 7 nodes — Agent "Search Companies (Web)" + hermes model (gateway cred bound, Responses API off, maxTokens 8000) + shared `web_search` SearXNG tool; Parse Segment Leads/Explode/Save carried over verbatim, retry/onError flags preserved). Old worker `mW1FZfk7OaM1utBS` UNPUBLISHED, new one PUBLISHED on the same webhook path `wf03-segment-worker` — copy 4 needs no change. (In-place update impossible: MCP update_workflow still schema-broken; create-and-swap used instead.)
- [x] SearXNG credential resolved: user's `Header Auth account 3` (`NYfSrSw1pUmsYjPL`, personal project, shared into REACH ARSENAL) — **verified working live**: searcheck-003 test returned 3 real Warsaw cyber-security firms (cyberblock.pl, itbsc.pl, hellosupport.pl) from live SearXNG results through the funnel. (Lesson: production webhooks run the PUBLISHED version — credential edits in the draft need a re-publish.)
- [x] Worker iterations (2026-06-11): **SEAR v1** (`UebAXjL0VFE7maXG`) — search loop works but hermes returns prose / echoes raw tool JSON instead of the leads schema → 0 parsed leads. **SEAR v2** (`WPIo2Wysuz34SEUY`) — added structured output parser with autoFix: WRONG MOVE on an 8B model — autoFix × retryOnFail spiraled into a 15+ min, 30+ LLM-call storm for ONE segment. **SEAR v3** (`5LcUx5jHULe679CR`, ACTIVE on `wf03-segment-worker`) — parser kept (schema instructions injected into prompt) but autoFix OFF + maxTries 2: fail fast, no spirals; both credentials bound by ID in code (no UI clicks).
- [ ] **USER: stop the zombie v2 execution** (n8n → WF-03 Segment Worker (SEAR v2) → Executions → stop the run started 11:07) — it's hogging hermes and starving the v3 test.
- [ ] Verify v3 test searcheck-006 result once the zombie is stopped (expect leadsJson with 3-6 real Warszawa companies in row of `wf3_segment_results`); then archive SEAR v1 + v2 + the old DEEPSEEK worker.
- [ ] Worker model quality follow-up: hermes3:8b struggles with the full 25-field production schema — evaluate Trev's `qwen3:8b` (tool-calling capable, better JSON discipline) via a new gateway alias + the AB harness; expect fewer/simpler fields per lead with hermes meanwhile.
- [ ] After worker rewiring: re-tune nationwide runs (a REAL searching worker at 111 segments won't fit the 45-min wait cap — test with `"region": "Warszawa, Kraków"` first, then raise `maxWaitMs`/cap `maxNationwideCities` for country sweeps); periodically purge stale rows from `wf3_segment_results` (342 old rows present; Reshape filters by runId so harmless, but it grows).
- [ ] Watch ai-litellm memory: 824MiB/1GiB (80%) after the ERP services moved onto the mini — if 502s recur without restarts, raise mem_limit; VM cap raise to 4.5 GB is tracked in the ERP migration block.
- [x] DIAGNOSED exec 5420 (copy 4, Drive-trigger `wf3-drv-20260611123156`, "Succeeded" in 47m doing NOTHING): 6 group-children dispatched → n8n cloud's ~5-execution concurrency cap admitted only 5, all 5 zombie-stalled with ZERO nodes executed (the 20s-poll parent held a slot throughout) → Eval Poll timed out at 45min with doneCount 0/111 → Collect Results had only June-10 rows → Reshape filtered by runId → 0 items → silent skip of everything downstream.
- [x] FIX BUILT — **copy 5** `x8lIakrh1EyDilTT` "EVERTRUST - LEAD SATELLITE copy 5 (SEAR batched)" (REACH ARSENAL, INACTIVE, validated 38 nodes, generator `tasks/wf03-copy5-gen.py` → `wf03-copy5.sdk.js`): splitInBatches(1) dispatches groups ONE at a time; 90s waits PARK the parent (frees its concurrency slot — fixes the self-starvation); per-group 25-min budget with cumulative row targets; NEW Guard Results THROWS on zero rows (loud failed execution) and console.warns shortfalls. Reshape reads runId from Build Groups.
- [ ] **USER: cancel zombie executions 5421–5425** (SEAR v3, "running" since 12:31Z with zero progress) — they hold concurrency slots.
- [ ] **USER: copy 5 credentials**: `web_search` node → `Header Auth account 3` (the verified SearXNG cred); spot-check the 6 auto-assigned Google creds.
- [ ] **USER: deactivate copy 4's Drive trigger** (exec 5420 proves it fires) so only one variant polls Drive; test copy 5 with a small region first (e.g. "Warszawa, Kraków"), then nationwide.

**WF-03 LEAD SATELLITE copy 6 (PG) — ERP-driven config + Postgres dual-write** (2026-06-12). DONE — generator `tasks/wf03-copy6-gen.py` (extends copy5-gen: replays the copy-5 surgery on `wf03-copy3.sdk.js`, then layers deltas A–G) → `tasks/wf03-copy6.sdk.js` (47 nodes); created INACTIVE as **`dCGzrlpaxpxJanbJ`** "EVERTRUST - LEAD SATELLITE copy 6 (PG)" in REACH ARSENAL (validate_workflow → valid, 47 nodes). Behaviorally tested in a sandbox: 3 targets × 3 cities → 27 segs (9/target), cap test 4 targets × 600 cities → exactly 500 segs, lead→prospect mapping + emailVerified honesty all correct.

- [x] A. ENTRY: webhook path `wf03-lead-research-v2`, body `{ campaignId, source }`; manual + Drive-poll triggers kept (Drive-poll has the "legacy trigger — remove after cutover" sticky).
- [x] B. CONFIG VIA ERP: Drive `config.json` read (Find/Download/Extract) replaced with `Fetch Campaign Config (ERP)` GET `/campaigns/{{campaignId}}/config` (httpHeaderAuth, UNBOUND) + `Normalize Config` Code (maps ERP response onto copy-5's `cfg` shape: niche.name string, region, country, defaulted maxToolCalls/maxTokens/targetTotal). Build Search Query + Has Static Profile read `$('Normalize Config')`.
- [x] C. THE GATE: `Niche Gate (targets ready?)` IF on targetCount==0 → `Trigger NICHE ANALYTICS` POST → `Gate: No Targets (throw)` Code; non-empty → Has Static Profile → Build Search Query.
- [x] D. TARGETS × CITIES: Build Search Query loops `cfg.targets` (phrase = searchHint||name) × the city slice, tagging each segment `nicheTargetId/Name/Slug/Phrase`. Cap MAX_PAIRS=500 (floor(500/T) cities/target) + MAX_SEGMENTS=500 backstop, console.warn on truncation. Batched fan-out mechanics byte-equivalent to copy 5.
- [x] E. PROSPECTS → POSTGRES: Sheet append kept; `sourceURL`+`nicheTargetId` threaded through `mkRow`, stripped in Build Sheet Rows (sheet stays byte-clean) → `Build Prospect Payload` → `POST /prospects/bulk (ERP)` (UNBOUND, FAILS on 4xx/5xx). emailVerified = email non-empty AND not-placeholder AND Status ''.
- [x] F. RUN CALLBACK: `Build Run Callback` (prospectsUpserted = created+updated) → `POST /arsenal/runs/callback (ERP)` (onError continueRegularOutput).
- [x] G. Copy-5 mechanics preserved (SEAR dispatch `wf03-segment-worker`, parsers, Guard Results throw, Reshape runId from Build Groups, `$('…').first()` fixes). Creds: models `2YgDmy9NuLHvOgzJ`, Drive-poll `R1hfa3xjcJxi0F2E`, `web_search` `newCredential('SearXNG (mac-mini)')`; 6 Google nodes auto-assigned on import; 3 ERP HTTP nodes left UNBOUND (sticky).
- [ ] **USER: copy 6 creds** — `web_search` → `Header Auth account 3` (SearXNG); the 3 ERP nodes (Fetch Campaign Config, POST /prospects/bulk, POST /arsenal/runs/callback) → an `ERP Ingest (x-arsenal-token)` httpHeaderAuth cred (create in REACH ARSENAL); spot-check the 6 auto-assigned Google creds. Endpoints live only after the ERP backend deploys.

## Backlog

- [x] ~~Fix Prisma config~~ / ~~Pick ONE ORM~~ / ~~port collision~~ / ~~add tests~~ — all RESOLVED by the 2026-06-11 migration: the boilerplate was replaced by the real ERP (Drizzle ORM, PORT env default 3001, 35 jest suites). Prisma/TypeORM are gone from the repo.
- [ ] **TLS for the ERP UI / API on the tailnet** (`tailscale serve`): would upgrade laptop access from plain HTTP to HTTPS and allow COOKIE_SECURE=true (see docs/team-hosting.md §9).
- [ ] **Consolidate the two Postgreses on the mini.** Homebrew postgresql@18 owns loopback 5432 (something actively connects to it) while Docker erp-postgres owns the published port — `localhost:5432` means different DBs depending on where you stand. Decide: retire brew postgres (move whatever uses it into the container) or make brew the ERP DB and drop the container. Until then: containers use the docker network, laptops use the Tailscale name.
- [ ] **Old n8n volumes cleanup.** `erp-server_n8n_data`, `erp-server_n8n_postgres_data`, `erp-server_pgadmin_data` still on disk; delete after confirming nothing local is needed (n8n is cloud now).

## Done

- [x] 2026-06-10 — Claude Code project setup: CLAUDE.md project context, 4 subagents, 4 slash commands, permissions in `.claude/settings.json`, tasks/ files, launch.json fix, `.DS_Store` gitignore entry.
- [x] 2026-06-10 — Compose hardening for the shared Mac mini stack (see Current Focus checked items). Resolved former backlog items: volume-path decision (postgres 18 pinned + constraint comment in compose), dead n8n basic-auth removed, obsolete `version:` key removed, `.env.example` created.

## Review

**2026-06-13 — C1 workflow_config wired into the NestJS API (env-fallback resolver + admin endpoints + guard hash).**
Added shared DTOs `WorkflowConfigDto` / `UpdateWorkflowConfigDto` (+ `ConfigFieldDto`, `DefaultSender`)
to packages/shared. New `WorkflowConfigService` (src/arsenal/workflow-config.service.ts): reads the
GLOBAL singleton, 5s in-memory cache + `invalidate()`, resolvers `getStageWebhook/getAimWebhook/
getN8nApiUrl/getIngestTokenHash` (each stored-override ?? env), `getEffective()` (full DTO), `update()`
(find-or-create upsert, no onConflict), and `setIngestTokenHash()` for the later rotation phase.
Provided via a `@Global() WorkflowConfigModule` (matches its global DB + AppConfigService deps; the
guard is provided in 6 modules so a global avoids per-module wiring). Refactored the 4 consumers to the
resolver (arsenal.service stage webhook, campaigns.service AIM, n8n-executions/n8n-backfill base URL —
API *key* stays env). ArsenalTokenGuard now async: if a stored SHA-256 hash exists it hashes the header
and timing-safe-compares, else falls back to the env constant-time compare (503/401 semantics preserved;
SHA-256 per the schema comment + task, NOT the line-234 argon2 note). Endpoints: GET/PUT /arsenal/config
in a new WorkflowConfigController (admin:config, audited PUT). Added a `makeWorkflowConfig` test helper +
fixed every changed constructor in the specs; new test/workflow-config.service.spec.ts (env fallback +
override wins + upsert) and rewrote the guard spec (async + rotated-hash cases).
VERIFY: `npm run build` clean, `pnpm --filter @evertrust/api typecheck` clean, full jest suite
**47 suites / 375 tests green**. Web UI (C2) + rotation/test-webhook actions (C3) still TODO.

**2026-06-11 — ERP monorepo import + mini infra ready (branch `migrate-evertrust-erp`).**
Imported `Ryugwki/evertrust-ERP@c118222` with renames (apps/api→erp-server, apps/web→erp-client,
packages/* kept), replacing all boilerplate. Verified: pnpm build/lint/typecheck green, 35 jest
suites / 299 tests green, `--frozen-lockfile` clean, both Docker images build AND boot (web
/login HTTP 200; api image has dist + curl + tsx). Live infra: Postgres swapped to
pgvector/pgvector:pg18 with full dump/restore (litellm DB + virtual key verified intact),
Docker VM 3→4.5 GB, ai-stack healthy, 401-keyless re-verified on all three funnel surfaces.
A 3-lens adversarially-verified review (20 agents) confirmed 15 findings — all fixed in
`aaa5dcc`, notably: fresh-volume DB bootstrap (postgres-init), production seed gating
(SEED_DEV_USERS), uploads-volume backup line, per-dev DATABASE_URL invocation docs, and the
8 missing docs/evertrust onboarding files. Remaining cutover steps are the unchecked items in
Current Focus (Render dump needs the user's external DB URL; .env fill is a user step).

**2026-06-10 — Shared-infra compose hardening.** `erp-server/docker-compose.yml` rewritten for the Mac mini hosting model (Tailscale hostname `mac-mini-ca-mac.tailc3d837.ts.net` as canonical `HOST_NAME`); `.env.example`, `docs/team-hosting.md`, `synchronize: false`, and `.claude` doc sync. Verified: `docker compose config` renders cleanly with a throwaway env file and fails fast with each `${VAR:?}` message without one; `npm run build` passes after the app.module.ts change. Stack `up` deliberately NOT re-run locally (existing local n8n volume holds the old encryption key; see docs §11). Cutover on the mini is a human step.

**2026-06-13 — Campaign TEMPLATES pipeline (outreach workflows read templates from PG, not Drive).** Backend contract for 3 n8n outreach workflows. Additive, deploy-safe.
- packages/db: `campaigns.templates jsonb` (nullable, `$type<Record<string,string>>()`) in schema; migration `drizzle/0020_campaign_templates.sql` = `ALTER TABLE "campaigns" ADD COLUMN "templates" jsonb;` (hand-written, idempotent-safe on fresh DB — new column); journal entry idx 20 (`when` 1780568000000, tag `0020_campaign_templates`). No 0000–0019 / snapshot touched. Did NOT run db:migrate (Render applies at boot). `@evertrust/db` typecheck green.
- packages/shared: `CampaignTemplatesDto = z.record(z.string(), z.string())`; referenced in `CampaignConfigDto` (`templates: …default({})`) and `CampaignDto` (`templates: …nullable()`); `CampaignTemplatesBodyDto = { templates }`. Barrel = the single index.ts (`export const` is the export).
- erp-server: NEW `CampaignTemplatesService.merge(campaignId, blocks)` (read-spread-write merge, never clobbers existing keys; 404 unknown; `writeMachineAudit` action TEMPLATES, actorType N8N; returns merged map). NEW route **POST /campaigns/:id/templates** = @Public + ArsenalTokenGuard (machine), the assets-route pattern. `getConfig` returns `templates: c.templates ?? {}`. `GET /campaigns/:id` (JWT) returns the row incl. templates via the widened CampaignDto. Service registered in campaigns.module.
- Verified: `@evertrust/shared` + `@evertrust/api` typecheck green; `@evertrust/api` build (nest build) green; jest **46 suites / 360 tests** all pass (was 45/355). New `test/campaign-templates.service.spec.ts` (5 tests): merge distinct keys across 2 POSTs (both survive), same-key overwrite, config exposes merged map, config defaults to {}, 404 unknown campaign.

## Settings v2 — General (app prefs) + Configuration (control panel)  [2026-06-13]

Correction: General is NOT the user profile (that's the avatar menu → /users/[id]).
General = app/website preferences. Configuration = EDIT the n8n/Postgres workflow
config (today env-only → redeploy to change), not a status dashboard.

User-chosen scope: General = theme + display prefs + EN/DE language. Configuration =
full Postgres-backed control panel.

Decisions: i18n = next-intl, cookie/pref mode (no /de/ URL prefix, avoids auth
middleware clash), translate incrementally. Secrets = never plaintext in PG; webhook
URLs editable in workflow_config; ingest token stored argon2-HASHED + rotate (machine
guard compares against hash); n8n API key stays env, status-only in UI.

General:
- [x] G1 Theme System/Light/Dark (next-themes provider + toggle; drop hardcoded
      <html class="dark">; rewrite general-settings.tsx from profile-clone → App prefs)
      DONE 2026-06-13 — verified light+dark on /login; default stays dark.
- [ ] G2 Display prefs — density, default landing page, date/timezone (client-stored)
- [ ] G3 Language EN/DE — next-intl setup + switcher; translate shell + Settings first

Configuration (db + shared + api + web):
- [x] C1 Foundation — workflow_config table (migration 0021) + Drizzle schema (DONE by
      prisma-database agent: schema.workflowConfig, GLOBAL singleton) + shared DTOs
      (WorkflowConfigDto / UpdateWorkflowConfigDto) + WorkflowConfigService
      (PG → env fallback, 5s cache, invalidate()); refactored arsenal.service
      STAGE_WEBHOOK_ENV + campaigns AIM + n8n-executions/backfill base URL to read via
      the resolver. NOTE: ingest-token hash is SHA-256 hex (matches the schema comment
      + the task), NOT argon2 — supersedes the line-234 argon2 note. API half of C2 +
      the guard-hash groundwork from C3 landed here (this session, nestjs-backend agent).
- [x] C2 (API half) — GET/PUT /arsenal/config (admin:config), audit-logged PUT.
      Web UI (Configuration page sections: webhook map, cadence/sender, catalog) = still TODO.
- [~] C3 Actions — guard now SHA-256-hash-aware (getIngestTokenHash → timingSafeEqual,
      env fallback preserved) + setIngestTokenHash() on the service so rotation is ready.
      Rotate endpoint + Test-webhook/Test-n8n actions = still TODO (later phase).

## Templates + Leads config sections [2026-06-13]
- [x] Migration 0022: workflow_config += default_template jsonb, signature, tone,
      template_language, max_leads_per_run, max_per_niche, daily_send_cap,
      default_regions text[], respect_suppressions, dedup_days, require_niche_analysis (applied)
- [x] API: WorkflowConfigDto/UpdateWorkflowConfigDto += templates{} + leads{}; service
      getEffective/update extended (gate booleans default true); GET /arsenal/lead-stats. 388 tests.
- [x] Web: Templates + Leads cards on Configuration (one Save flow) + live lead-stats
      metric strip; EN/DE i18n. typecheck+lint+build green.
- [ ] n8n read-side: Lead Satellite (caps/regions/dedup/gate), Ammo Forge (template/
      signature/tone/language), Bazooka (dailySendCap) must consume the new fields
