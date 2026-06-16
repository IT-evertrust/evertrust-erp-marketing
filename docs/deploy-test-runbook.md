# Deploy & test runbook — run your own org's outreach end-to-end

Goal: get the PG growth-engine pipeline (AIM → Lead Satellite + Ammo Forge → Reach
Bazooka → Reply Glock) running for **your own org** on the current n8n + Gmail stack.
This is "Bar 1" — it does NOT make the product multi-tenant/sellable (that's Phase 3,
the provider + onboarding work). It proves the whole pipeline works.

Branch: `feat/growth-engine-drive-to-postgres`. Live infra: API = Render, web = Vercel,
DB = Supabase, automation = n8n cloud.

---

## 0. Pre-flight — what you need
- [ ] Supabase SQL editor access (you've used this path).
- [ ] Render dashboard access (API env + deploy).
- [ ] Vercel access (web deploy).
- [ ] n8n cloud access (bind credentials, activate workflows).
- [ ] The `x-arsenal-token` value (the shared ingest token) — must match on BOTH sides
      (Render `ARSENAL_INGEST_TOKEN` and the n8n `x-arsenal-token` credential).
- [ ] 2–3 test inboxes you control to use as fake "prospects" (so the test never emails
      real cold leads).

---

## 1. Database — bring Supabase to branch head
The branch adds migrations 0024–0028. Two ways:

- **Auto (preferred):** deploying the API to Render runs `api-start.sh` → `db:migrate`
  against `DATABASE_URL` (Supabase) on boot. If your Render start command runs
  `api-start.sh` (the container does), the migrations apply themselves on deploy.
- **Manual (fallback / apply first):** in the Supabase SQL editor, run in order
  (all idempotent):
  - [ ] `packages/db/scripts/0005_add_owner_role.sql` (OWNER enum — run its two parts)
  - [ ] `packages/db/scripts/0006_workflow_config_supabase.sql` (workflow_config; no-op if present)
  - [ ] `packages/db/scripts/0007_per_org_and_signature_supabase.sql` (org_config + split +
        signature_assets + org_senders + sales_calendar_id = 0025→0028)

**Verify:** in Supabase, confirm tables `org_config`, `signature_assets`, `org_senders`
exist and `org_config.sales_calendar_id` is present; `workflow_config` has NO `signature`/
`default_template`/`default_sender` columns (they moved to org_config).

---

## 2. Backend — deploy the API to Render + env
- [ ] Deploy the branch (merge to `main` or point the Render service at the branch).
- [ ] Confirm these env vars on Render:
  - `DATABASE_URL` → Supabase (already set).
  - `ARSENAL_INGEST_TOKEN` → the shared token; **must equal the n8n `x-arsenal-token`
    credential value** (this is what every machine route checks).
  - `AUTH_DISABLED=false` (real login in production — never `true` on the live API).
  - `N8N_API_URL` / `N8N_API_KEY` → for the Growth Engine live stage-status strip.
  - `N8N_AIM_WEBHOOK_URL` → the AIM v2 (PG) webhook (the campaign-launch trigger).
  - `N8N_REACH_BAZOOKA_WEBHOOK_URL` (+ the other `N8N_*_WEBHOOK_URL`) OR set them in the
    Configuration UI (`workflow_config`) → must point at the **v2 PG** workflow webhooks.
  - `SALES_CALENDAR_ID` (optional) → fallback Google Calendar id (e.g. `info@evertrust-germany.de`).
- [ ] Hit `GET https://evertrust-api.onrender.com/health` → 200.

**Verify:** the new endpoints exist — `GET /campaigns/:id/config` returns an `automation`
block carrying `senders`, `defaultSenderEmail`, `salesCalendarId`.

---

## 3. Frontend — deploy the web to Vercel
- [ ] Deploy the branch. (This also turns on Speed Insights + Web Analytics — they start
      collecting after this deploy.)
- [ ] Log in → Configuration page → confirm the **Senders** editor, **default sender**
      picker, **Sales calendar ID** field, and **Signature image** control all render.

---

## 4. n8n — credentials + wiring (the manual bits the API can't do)
- [ ] **Bind `x-arsenal-token`** on EVERY ERP HTTP node (httpHeaderAuth) in each ACTIVE
      PG workflow — the API can't set httpHeaderAuth, so this is UI-only:
  - AIM v2 (PG) `QDvotfZeo03bZy7m`
  - Lead Satellite copy 6 (PG) `dCGzrlpaxpxJanbJ` (incl. the new `Check Existing Prospects`,
    `Fetch Campaign Config`, `POST /prospects/bulk`, `POST /arsenal/runs/callback`)
  - Ammo Forge (PG) v2 `rDLhY3sqi6U9xK6t`
  - Reach Bazooka (PG) v2 `zyCTVLpZj3YyR2qV`
  - Reply Glock (PG) v2 `5QkBzSzK1UdxiE96`
  - Niche Analytics `jgOVy4Ox9fCtpT7S` (the `Get Campaign Config` node)
- [ ] **Fix `web_search`** (Lead Satellite) → Header Auth = the SearXNG `X-Search-Key`
      credential (NOT `x-arsenal-token`). Header name `X-Search-Key`, value = `SEARXNG_API_KEY`
      from `ai-stack/.env` / the vault.
- [ ] **Verify `Hermes — Search Model`** (Lead Satellite) → credential = `LiteLLM Gateway (mac-mini)`.
- [ ] **Gmail credentials** present for the senders you'll use: `info@` and `hanna@`
      (Bazooka send + Reply Glock poll + Calendar).
- [ ] Confirm the stage webhook URLs (env or Configuration) point at the **v2 PG** workflows.

---

## 5. Activate the workflows
- [ ] Confirm active in n8n: AIM v2, Lead Satellite copy 6, Ammo Forge v2, Reach Bazooka v2,
      Reply Glock v2 (most already are).
- [ ] **Reach Bazooka sends REAL email** — for the test, keep it send-capped + run it manually
      (not the 8AM schedule) so you control the blast.

---

## 6. End-to-end test (supervised, safe)
Use a test campaign whose "prospects" are inboxes YOU own.

1. [ ] **AIM:** create + launch a campaign in the ERP. Campaign flips DRAFT → ACTIVE; the
       AIM v2 webhook fires.
2. [ ] **Niche Analytics → Lead Satellite:** targets get generated, then Lead Satellite
       scrapes. Watch the n8n logs: `[Decide] … decision=HUNT`, `[Parse Leads] … rows=N`,
       `[Prospect Payload] … prospects=N`. → rows land in Supabase `prospects` (filter
       `campaign_id`). (For a controlled test you can instead seed a couple of your own
       addresses as prospects via `POST /prospects/bulk`.)
3. [ ] **Ammo Forge:** template written → `campaigns.templates` (check via the ERP).
4. [ ] **Reach Bazooka (manual, capped):** sends from `info@`/`hanna@` → a real email
       arrives in your test inbox; `outreach_messages` = SENT, prospect `status` = EMAILED.
5. [ ] **Reply:** reply to that email from the test inbox → Reply Glock classifies it →
       `reply_classifications` row + `status` = REPLIED/INTERESTED. If INTERESTED → a `leads`
       row is created (graduation), and a meeting → a Google Calendar event **with a Meet link**.

---

## 7. What success looks like (verification)
- [ ] `prospects` rows for the campaign (Supabase + ERP prospect board).
- [ ] `outreach_messages` SENT + a real email received.
- [ ] `reply_classifications` + status transition on reply.
- [ ] A `leads` row after an INTERESTED reply (graduation).
- [ ] `arsenal_runs` entries in the ERP "live activity" feed for each stage.
- [ ] No 401/403 from the ERP machine routes (means the ingest token matches) and no
      SearXNG 401 (means the `web_search` cred is right).

---

## 8. Safety / rollback
- Bazooka is the only destructive stage (sends real mail) — keep it manual + send-capped
  during the test; only enable the 8AM schedule once a clean run passes.
- Everything DB-side is idempotent; re-running migrations/seeds is safe.
- This runbook is single-tenant (your org). Selling to clients needs Phase 3 — see the
  per-org-sending design (provider + domain verification + inbound webhook). Do NOT mark
  the product "sellable" off this runbook.
