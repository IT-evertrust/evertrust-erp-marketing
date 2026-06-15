-- Per-org config SPLIT (design B): move the CUSTOMER-FACING outreach prefs off the
-- GLOBAL workflow_config singleton into the per-org org_config table (one row per
-- org). workflow_config STAYS a global singleton for PLATFORM INFRASTRUCTURE only
-- (n8n webhook URLs, n8n_api_url, the ingest token, the sequence offsets, the
-- singleton guard + timestamps) — those are never per-tenant.
--
-- Step 1 BACKFILL: for EVERY organization, seed an org_config row from the existing
-- global workflow_config prefs (the single LIMIT 1 row). LEFT JOIN onto a one-row
-- subquery so this is safe when workflow_config is EMPTY (no row → all prefs NULL,
-- which is the correct "fall back to product default" semantics). ON CONFLICT DO
-- NOTHING makes it idempotent and a no-op for orgs that already have a row (e.g. a
-- re-run, or a row created by 0025's table after app boot).
INSERT INTO "org_config" (
	"organization_id",
	"default_template",
	"signature",
	"tone",
	"template_language",
	"default_sender",
	"max_leads_per_run",
	"max_per_niche",
	"daily_send_cap",
	"default_regions",
	"respect_suppressions",
	"dedup_days",
	"require_niche_analysis"
)
SELECT
	o."id",
	w."default_template",
	w."signature",
	w."tone",
	w."template_language",
	w."default_sender",
	w."max_leads_per_run",
	w."max_per_niche",
	w."daily_send_cap",
	COALESCE(w."default_regions", '{}'::text[]),
	w."respect_suppressions",
	w."dedup_days",
	w."require_niche_analysis"
FROM "organizations" o
LEFT JOIN (SELECT * FROM "workflow_config" LIMIT 1) w ON true
ON CONFLICT ("organization_id") DO NOTHING;
--> statement-breakpoint
-- Step 2 DROP the now-migrated pref columns from the global singleton. IF EXISTS so a
-- re-run on an already-split DB is a no-op. Everything else on workflow_config (the
-- infra URLs, ingest_token_hash/set_at, the offsets, singleton, timestamps) stays.
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "default_template";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "signature";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "tone";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "template_language";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "default_sender";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "max_leads_per_run";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "max_per_niche";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "daily_send_cap";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "default_regions";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "respect_suppressions";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "dedup_days";--> statement-breakpoint
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "require_niche_analysis";
