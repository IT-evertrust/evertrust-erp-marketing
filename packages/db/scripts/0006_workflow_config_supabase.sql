-- ============================================================================
-- EverTrust — bring the LIVE Supabase DB up to the workflow_config schema the
-- deployed API expects (Drizzle migrations 0021 + 0022). Run in the Supabase
-- SQL Editor.
--
-- WHY: the AIM "Lock & Load" flow reads workflow_config (getAimWebhook →
-- getEffective → SELECT * FROM workflow_config). If the table (or any 0022
-- column) is missing on Supabase, that SELECT throws → HTTP 500 "Internal
-- server error" AFTER the campaign was already saved as DRAFT (hence the stray
-- "Draft 1"). The Configuration page reads/writes the same table, so it 500s too.
--
-- Fully idempotent (IF NOT EXISTS everywhere) — safe to run whatever the current
-- state. Local/Docker is already covered by db:migrate.
-- ============================================================================

-- ── 0. CONFIRM the gap first (read-only). Empty result = table missing = the bug.
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'workflow_config'
--  ORDER BY ordinal_position;

-- ── 1. Base table (migration 0021) ──
CREATE TABLE IF NOT EXISTS "workflow_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"aim_webhook_url" text,
	"lead_satellite_webhook_url" text,
	"ammo_forge_webhook_url" text,
	"reach_bazooka_webhook_url" text,
	"reply_glock_webhook_url" text,
	"sleeper_grenade_webhook_url" text,
	"n8n_api_url" text,
	"ingest_token_hash" text,
	"ingest_token_set_at" timestamp with time zone,
	"default_sender" text,
	"followup_offset_days" integer,
	"final_push_offset_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_config_singleton_uq" ON "workflow_config" USING btree ("singleton");

-- ── 2. Templates + Leads columns (migration 0022) ──
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "default_template" jsonb;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "signature" text;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "tone" text;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "template_language" text;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "max_leads_per_run" integer;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "max_per_niche" integer;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "daily_send_cap" integer;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "default_regions" text[] DEFAULT '{}'::text[];
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "respect_suppressions" boolean;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "dedup_days" integer;
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "require_niche_analysis" boolean;

-- ── 3. (optional) Clean up the orphan DRAFT(s) left by the failed Lock & Load
-- attempts, so you start clean. Inspect first, then delete if you want:
-- SELECT id, project, lifecycle, created_at FROM campaigns WHERE lifecycle = 'DRAFT';
-- DELETE FROM campaigns WHERE lifecycle = 'DRAFT' AND project = 'CS PL 2026';
