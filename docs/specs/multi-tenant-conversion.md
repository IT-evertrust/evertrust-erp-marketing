# Multi-Tenant SaaS Conversion — Inventory & Plan

**Status:** planning · **Created:** 2026-06-15 · **Owner:** platform (OWNER role)

## 0. Summary
The ERP is being turned into a sellable multi-tenant SaaS: each customer is an
`organization` with its own users (any number, various roles) **and its own
config + identity**. The **data plane is already multi-tenant** — `organizations`
is the tenant root, ~30 of 38 tables carry `organizationId` (children inherit via
parent FK), and RBAC is org-aware (OWNER is the only cross-org role, via
`isOwner()`). The conversion work is concentrated in the **config + identity
layer** (ERP) and the **n8n workflows** (the largest lift), which bake EverTrust
in deeply.

This doc inventories everything that must become per-org and lays out a phased
plan. Evidence (file:line) from a three-way scan of `erp-server/`, `erp-client/` +
`packages/*`, and the live n8n workflows.

## 1. Already multi-tenant — no work needed
- `organizations` tenant root + `tenantScope()`/`OrgId` (`erp-server/src/common/tenant.ts`).
- ~30 tables org-scoped: tenders, customers, suppliers, prospects, niches, campaigns, meetings, contracts, leads, outreach, pricing, performance, arsenal_runs/settings, etc. Children inherit via parent FK.
- RBAC: `UserRole` + `isOwner()` (`packages/shared/src/index.ts`) — OWNER cross-org, all others tenant-scoped. `arsenal_settings` is the model one-row-per-org pattern to copy.

## 2. Foundation — two changes unlock most of it
- [ ] **`workflow_config` → per-org.** Add `organizationId` (NOT NULL FK), drop the global `singleton` boolean + `workflow_config_singleton_uq`, add unique index on `organizationId`; `WorkflowConfigService.row()` → `row(orgId)` (find-or-create per org), resolver stays **org value ?? env**. Files: `packages/db/src/schema/workflow-config.ts:12-36`, `erp-server/src/arsenal/workflow-config.service.ts:79-87`. Cascades to: stage/AIM webhooks, n8n base URL, ingest token, default sender, offsets, templates+signature, lead governance.
- [ ] **`organizations` gets a config/branding home** (today identity-only: `id/name/slug`, `packages/db/src/schema/org.ts:10-21`). Add (or a new `org_settings` child): display/product name, logo URL, support email, sender domain, default calendar id, timezone, locale, **internal email domains**.

## 3. Identity & branding (the "email / sender" surface)
- [ ] **Per-org sender mailboxes.** Replace hardcoded `CAMPAIGN_SENDERS`/`CAMPAIGN_SENDER_LABELS`/`DefaultSender` (`info@`/`hanna@evertrust-germany.de`) at `packages/shared/src/index.ts:1087-1092, 2489` with an org alias→email list; make `sender` runtime-validated, not a compile-time enum. Cascades to `aim-launch-dialog.tsx`, `configuration-settings.tsx:110,862,873`, i18n sender labels.
- [ ] **Per-org sales calendar.** `salesCalendarId: 'info@evertrust-germany.de'` hardcoded at `erp-client/src/components/growth/aim-launch-dialog.tsx:196` — **live cross-tenant leak**; source from org config.
- [ ] **Internal-domain rule** `'@evertrust-germany.de'` at `erp-server/src/meetings/meetings.extract.ts:13` → `org.internalDomains`.
- [ ] **Frontend branding** — `layout.tsx:25`, `login/page.tsx:40`, `topbar.tsx:36`, `sidebar-nav.tsx:191/195` (EverTrust fallbacks) + EN/DE `login.json`/`dashboard.json` strings → org branding / neutral defaults (login is pre-auth → neutral or subdomain-themed).
- [ ] **Signature image (the original ask)** — per-org field on the per-org config: upload (Postgres-stored, served at a public URL) **or** link (Drive→`lh3.googleusercontent.com/d/<id>`), with preview. Folds into Phase 1.

## 4. n8n workflows — biggest lift (EverTrust baked into nodes)
- [ ] **Persona/prompts data-driven** — "Hanna Nguyen / EVERTRUST GmbH", sign-offs, the German-public-tender business thesis, reply/re-engage voice (Ammo Forge, RAG "BE HANNA", Reply Glock, Sleeper) → `{{org.*}}` interpolation.
- [ ] **Per-org credentials** — Gmail ×2, WhatsApp Cloud (phone id `1030239273516528`), Calendar, Drive, `x-arsenal-token`. `IF sender contains "hanna"` routing → role→mailbox map.
- [ ] **Hardcoded identifiers** — manager WhatsApp `84333634500`, calendar `info@evertrust-germany.de`, review inbox `marketing@evertrust.de`, logo image `lh3…/d/1mNy9SN…`, Drive folder IDs, "Evertrust Campaigns" root.
- [ ] **Base URLs** → env: ERP base (`evertrust-api.onrender.com` — **verify live host**), n8n host (`evertrustgmbh.app.n8n.cloud`), SearXNG host.
- [ ] **Seam:** extend `GET /campaigns/:id/config` (every workflow already calls it) to embed an `organization` block (name, mailboxes, persona, calendar, whatsapp, internal domains, branding); nodes read it instead of literals.

## 5. Isolation & onboarding
- [ ] **Per-org ingest token** — global `ARSENAL_INGEST_TOKEN` is the only auth on public n8n callback routes; guard should resolve org from token so callbacks are tenant-isolated.
- [ ] **`embeddings` tenancy** — only data table with no `organizationId` (`packages/db/src/schema/observability.ts:105`) → RAG cross-tenant leak; add + filter.
- [ ] **Onboarding** — `packages/db/src/seed.ts:35-52` hardcodes Evertrust GmbH + admin emails; add a signup/provisioning flow (org + first admin) — ties to OWNER.

## 6. Bonus bugs surfaced by the scan
- [x] **n8n → API host** — RESOLVED 2026-06-15: the live ERP API **is** on Render (`evertrust-api.onrender.com`); the Mac mini is only the local AI stack. n8n base URLs are correct (not stale). ⚠️ CLAUDE.md is wrong here ("hosting moved … to the Mac mini") — needs correcting.
- [ ] **AIM v2 still triggers the OLD `wf4-ammo-forge`** (PG cutover for that leg unfinished).
- [ ] **`embeddings` cross-tenant leak** (see §5).
- [x] **`STAGE_WORKFLOW_ID` pointed at old/inactive workflows** — fixed 2026-06-15 (repointed to PG ids).

## 7. Phased plan
- **Phase 1 — ERP foundation (in-repo, buildable now):** §2 (workflow_config per-org + organizations config columns) + §3 per-org sender list + the per-org signature image. Makes the Configuration page per-tenant.
- **Phase 2 — n8n org-config seam:** §4 — embed `organization` in `/campaigns/:id/config`; repoint workflow nodes to read it; fix base URLs.
- **Phase 3 — credentials + isolation + onboarding:** §4 per-org credentials, §5 per-org token + embeddings scoping + signup flow.

## 8. Integration gaps (ERP ↔ new PG workflows)
Method: diffed every ERP call the 8 PG workflows make against the ERP's machine
surface; verified high-impact findings in code (2026-06-15).

**Verdict: the contract is largely sound.** The ERP's ~19 machine routes
(`ArsenalTokenGuard`/`@Public`) line up with what the PG workflows call —
`GET /campaigns/:id/config`, `GET /campaigns/machine/list`, `POST /campaigns/:id/{templates,assets}`,
`POST /niches/:id/targets/bulk`, `POST /prospects/bulk`, `GET`/`PATCH /prospects/:id` (+`/graduate`),
`POST`/`GET /outreach-messages`, `GET`/`POST /reply-classifications`, `POST /suppressions`,
`POST /notifications`, `POST /arsenal/runs/callback`. Bodies + enums match.

**Confirmed gaps (real missing logic):**
- [x] 🔴 **Snooze → re-engage loop** — FIXED 2026-06-15. REPLY GLOCK's `ERP — Classify Not Interested` now posts `verdict:"SNOOZE"` + top-level `snoozeUntil` for *temporary* (snooze) replies; *permanent* (do-not-contact) stays `NOT_INTERESTED`. ERP sets `prospect.snoozeUntil` (reply-classifications.service.ts:94) → Sleeper Grenade can re-engage. (Workflow was live; change is in effect.)
- [~] 🟠 **NICHE ANALYTICS config auth** — node auth set to Header Auth 2026-06-15; **manual step left:** select the `x-arsenal-token` credential (id `NYfSrSw1pUmsYjPL`) on the `Get Campaign Config` node in the n8n UI (same as its sibling ERP nodes).

**Infra / cutover (from the broader scan):**
- [x] ERP base URL `evertrust-api.onrender.com` — CONFIRMED correct (Render is the live API host; the mini is local-AI only). No repoint needed.
- [ ] AIM v2 active version triggers OLD `wf4-ammo-forge` (draft → `…-pg`).

**Ruled out (verified — NOT bugs):** arsenal run callback (stage enum + `metrics` accepted; the `z.preprocess(...)` was an agent misread), prospects `sendList`/`email`/`snoozeDue` filters, `reply-classifications?needsRag`, `outreach-messages?prospectId` — all supported in code.

**Orphans (ERP offers, these 8 workflows don't call):** `POST`/`PATCH`/`GET /contracts` — likely a separate contract/Hermes workflow; not a gap here.

**Minor:** confirm `POST /campaigns/:id/templates` value types (n8n sends `{templates:{coldEmail,newsBrief}}`; controller reads `body.templates`, so the wrapper is correct).
