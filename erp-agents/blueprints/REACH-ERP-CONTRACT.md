# REACH ↔ ERP integration contract

Source of truth: `evertrust-erp-marketing` (NestJS, DB on **Supabase**, deployed
`https://evertrust-api.onrender.com`, free-tier → sleeps ~15 min idle).
The ERP — not Neon — is the data layer the n8n REACH stage talks to.

## Auth (machine routes)
- Header **`x-arsenal-token`** = env **`ARSENAL_INGEST_TOKEN`** (or per-workflow rotated hash).
- Guard: `common/guards/arsenal-token.guard.ts`. 401 wrong/missing, 503 if no token configured.
- Machine routes are `@Public() + ArsenalTokenGuard` (no JWT).

## Reach Bazooka = arsenal stage `REACH_BAZOOKA` (GLOBAL)
Stages: `LEAD_SATELLITE | AMMO_FORGE | REACH_BAZOOKA | REPLY_GLOCK | SLEEPER_GRENADE`.
Triggered by ERP **`POST /arsenal/REACH_BAZOOKA/run`** (Run-now, no campaignId for global) or
the daily scheduler (`arsenal_settings.bazookaDailyAt/Timezone`). **No n8n webhook trigger.**
n8n runs autonomously, then posts the outcome back.

## Endpoints the reach send loop uses
1. `GET /campaigns/machine/list?lifecycle=ACTIVE` → `[{id,name,project,country,region,sender,gmailLabel,driveFolderId,nicheId}]`
2. `GET /campaigns/:id/config` → templates (`templates.coldEmail`), niche+targets, `automation.leads.{dedupDays,respectSuppressions}`
3. `GET /prospects?campaignId=:id&sendList=true&limit=500` → eligible send list. **`sendList=true` applies governance**: ACTIVE campaign only, status ∈ {NEW,EMAILED,REPLIED,RE_ENGAGED}, cooldown (default 3d via `lastContactedAt`), suppression list, `followupCount < 5`.
   Prospect: `{id,email,companyName,website,city,country,status,snoozeUntil,followupCount,lastContactedAt,campaignId,...}`
4. `POST /outreach-messages` per send → `{prospectId, direction:"OUTBOUND", status:"SENT", gmailMessageId, gmailThreadId, subject, bodySnippet, templateAssetId?, sentAt?}` (upserts on gmailMessageId)
5. `PATCH /prospects/:id` → `{status:"EMAILED", followupCount: n+1, lastContactedAt: <ISO>}`
6. `POST /arsenal/runs/callback` (x-arsenal-token) → `{stage:"REACH_BAZOOKA", status:"SUCCESS"|"ERROR", detail?, metrics:{emailsSent: N}}` → ERP records `arsenal_runs` + Marketing report.

Prospect status enum: `NEW | EMAILED | REPLIED | INTERESTED | MEETING_SCHEDULED | NOT_INTERESTED | RE_ENGAGED | DO_NOT_CONTACT`.

## Related (other stages, same auth)
- Lead Satellite ingest: `POST /prospects/bulk {campaignId, prospects:[{email,companyName,website,city,country,sourceUrl,nicheTargetId,emailVerified}]}` (upsert on (campaignId,email); never regresses server-owned fields).
- Reply Glock: `GET|POST /reply-classifications`, `GET /outreach-messages?prospectId=`, `POST /suppressions`, `POST /prospects/:id/graduate {stage,hotReason,note}`.

## Data in / config
- Prospects enter ONLY via `POST /prospects/bulk` (Lead Satellite) — no generic import. Local dev has an idempotent seed in `packages/db`.
- Local run: `corepack pnpm --filter @evertrust/api start:dev` → `http://localhost:3001`, needs a dev `DATABASE_URL` (never prod). `ARSENAL_INGEST_TOKEN` set locally to whatever you choose.
- ERP→n8n config: `N8N_API_URL=https://evertrustgmbh.app.n8n.cloud`, `N8N_API_KEY` (executions poll), `N8N_REACH_BAZOOKA_WEBHOOK_URL` intentionally blank (scheduler-only).

## To link the n8n REACH BAZOOKA (PG) v2 workflow
- Base URL → `https://evertrust-api.onrender.com` (or local `http://localhost:3001`).
- Bind Header Auth credential to the `ARSENAL_INGEST_TOKEN` value on every ERP HTTP node.
- Ensure nodes match the paths/fields above; add the final `POST /arsenal/runs/callback` with `{emailsSent}`.
