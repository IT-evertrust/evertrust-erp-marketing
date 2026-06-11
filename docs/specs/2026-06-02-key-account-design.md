# Key Account (hot-leads CRM) — design

**Date:** 2026-06-02
**Status:** approved, building
**Scope:** Second of the three role pages (Marketing done). Sales is a separate later cycle.

## Goal

A `/key-account` page: a **hot-lead CRM** that mirrors the n8n hot-leads subsystem and lets a key-account manager review hot leads and graduate them to ERP customers.

Pipeline (matches n8n's stage vocabulary): **Interested → Meeting Scheduled → Customer**.

## n8n integration (the two workflows the user named)

- **Provision Hot Leads** (`s65rZ9hiuvVCbKu5`) — `POST /webhook/provision-hot-leads {folderId}` creates an empty `hot_leads` sheet in a campaign folder and returns `{ success, hotLeadsSheetId, hotLeadsUrl }`. **Used for the hot-leads sheet provisioning action.** ⚠️ Known bug: its Move node reads `$('test').item.json.folderId` not the webhook body, so webhook calls error — needs a one-line fix in n8n before the ERP action works (documented, not auto-fixed).
- **Hot Leads Pipeline** (`Dddp6wSvw3rwEsOw`) — its `Compute Intake + Graduate` node emits `_t:"hot"` rows (hot leads) **and** `_t:"cust"` rows (graduated customers, written to the "Evertrust CRM" Google sheet). **Used as the data source for both hot leads and customers** (via execution-data backfill), and as a per-campaign trigger. Today it's schedule-only; to trigger from the ERP a **Webhook (POST `{folderId}`)** node must be added in n8n.

Triggers fire as **POST** with `{ folderId }` (campaign Drive folder) — side-effecting + per-campaign, consistent with Provision Hot Leads + the per-campaign arsenal stages.

## Data model — new `leads` table (migration 0012)

Mirrors the 14-column hot_leads row + ERP fields:
- `email` (dedup key, **unique per org**), `companyName`, `companyType`, `website`, `city`, `country`, `tier`, `niche`, `sourceCampaign` (the n8n "Source Campaign" = campaign project name), `campaignId`→campaigns (best-effort: match sourceCampaign→campaign.project), `hotReason`, `leadStatus`, `meetingDate` (text), `detectedAt` (timestamptz), `note`
- `stage` enum **lead_stage**: `INTERESTED | MEETING_SCHEDULED | CUSTOMER | ARCHIVED`
- `customerId`→customers (set on conversion), `source` enum **lead_source**: `N8N | MANUAL`, `createdAt`, `updatedAt`
- unique index `(organization_id, email)`.

## Backfill (reuse the n8n-backfill pattern)

`POST /leads/backfill` reads the Hot Leads Pipeline (`Dddp6wSvw3rwEsOw`) execution data → `Compute Intake + Graduate` node output:
- **`_t:"hot"`** → upsert lead by (org,email); `stage` from `Hot Reason` (Interested→INTERESTED, MeetingScheduled→MEETING_SCHEDULED). Never downgrades a CUSTOMER lead.
- **`_t:"cust"`** → upsert lead `stage=CUSTOMER`; if `customerId` is null, create an ERP `customers` row from the lead + link it (idempotent — guarded by `customerId`). This is the "Hot Leads Pipeline → customer" path.

Honest caveat: execution-data backfill captures leads within n8n's retained executions; the complete history lives in the `hot_leads` sheets (reading those directly = Google API, deferred). Idempotent: upsert by email; customer created once.

## API — new `leads` module

- `GET /leads` (campaigns:read) — org leads; filters `?stage`, `?campaignId`.
- `POST /leads` (campaigns:write) — manual add.
- `PATCH /leads/:id` (campaigns:write) — stage / note / fields.
- `POST /leads/:id/convert` (customers:write) — create ERP customer from the lead + link (`stage=CUSTOMER`); 409 if already converted.
- `POST /leads/backfill` (campaigns:write) — sync from the Pipeline (above).
- `POST /leads/provision` (campaigns:write) — `{campaignId}` → fire Provision Hot Leads webhook with that campaign's `driveFolderId`; returns `{ hotLeadsUrl }`. Env-gated (blank URL → 400/disabled).
- `POST /leads/run-pipeline` (campaigns:write) — `{campaignId?}` → fire Hot Leads Pipeline webhook (POST `{folderId}`). Env-gated.

Env (all `z.string().default('')`, blank = action disabled): `N8N_PROVISION_HOT_LEADS_WEBHOOK_URL`, `N8N_HOT_LEADS_PIPELINE_WEBHOOK_URL`. Backfill reuses `N8N_API_URL`/`N8N_API_KEY`.

## Web — `/key-account`

Nav: add **Key Account** under *Acquisition*.
- **CRM board**: columns **Interested · Meeting Scheduled · Customer**; card = company · niche · tier · source campaign · detected-at.
- Click card → **detail panel**: the hot-lead fields + note; a **stage** selector; **Convert to customer** button.
- Header: campaign filter + **Sync from n8n** + **Add lead** + (env-gated) **Provision sheet** / **Run pipeline**.
- Hooks: `useLeads(filters)`, `useCreateLead`, `useUpdateLead`, `useConvertLead`, `useLeadsBackfill`, `useProvisionHotLeads`, `useRunHotLeadsPipeline`. api client + query keys.

## Tests

- leads service: list/filter; manual create; stage update; convert creates+links a customer (+409 when already converted); backfill upsert (hot→stage, cust→CUSTOMER+customer, idempotent).
- backfill extractor: parse `Compute Intake + Graduate` `_t:"hot"`/`_t:"cust"` rows from sample runData.
- permissions: read=campaigns:read, write=campaigns:write, convert=customers:write.

## Out of scope (v1)

Raw email-body review (hot_leads has *who/why*, not the reply text — that's in Reply Glock/Gmail; future Gmail-link). Reading `hot_leads` Sheets directly (Google API). Drag-and-drop columns (use stage selector). Reflecting ERP conversions back into the n8n CRM sheet.

## Caveats to flag

1. Provision webhook folderId bug (one-line n8n fix needed).
2. Hot Leads Pipeline needs a POST webhook node added to be ERP-triggerable.
3. n8n graduates to a Google "Evertrust CRM" sheet in parallel; the ERP `customers` table is a separate system of record — unifying them is a future decision.
