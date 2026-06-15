-- =============================================================================
-- Supabase catch-up: per-org config split + signature images (branch head)
-- =============================================================================
-- Brings a Supabase database up to the head of the
-- feat/growth-engine-drive-to-postgres branch for the multi-tenant config work.
-- Folds in three Drizzle migrations so they can be pasted into the Supabase SQL
-- editor in ONE run:
--   0025_org_config        — the per-org org_config table
--   0026_org_config_split  — move customer prefs off the global workflow_config
--                            singleton into org_config (guarded backfill + drops)
--   0027_signature_assets  — per-org uploaded signature-image store
--
-- Fully idempotent: re-running is a no-op. Safe to run after a partial apply.
--
-- PREREQUISITES (run first if your Supabase is not already there):
--   • workflow_config must exist — run scripts/0006_workflow_config_supabase.sql.
--   • the OWNER role enum value is unrelated and applied separately
--     (scripts/0005_add_owner_role.sql) — NOT included here, because
--     `ALTER TYPE ... ADD VALUE` cannot share a transaction with table DDL.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 0025 — per-org config table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "org_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"default_template" jsonb,
	"signature" text,
	"signature_image_url" text,
	"tone" text,
	"template_language" text,
	"default_sender" text,
	"max_leads_per_run" integer,
	"max_per_niche" integer,
	"daily_send_cap" integer,
	"default_regions" text[] DEFAULT '{}'::text[],
	"respect_suppressions" boolean,
	"dedup_days" integer,
	"require_niche_analysis" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "org_config" ADD CONSTRAINT "org_config_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "org_config_organization_id_uq" ON "org_config" USING btree ("organization_id");

-- ----------------------------------------------------------------------------
-- 0026 — split: backfill org_config from the global workflow_config prefs, then
-- drop those columns off the singleton. The backfill is GUARDED so this whole
-- script stays re-runnable: it only runs while the pref columns still exist on
-- workflow_config (dynamic EXECUTE so the dropped-column reference never fails to
-- parse on a second run), and it is a no-op when workflow_config is absent.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'workflow_config'
		  AND column_name = 'default_template'
	) THEN
		EXECUTE $bf$
			INSERT INTO "org_config" (
				"organization_id", "default_template", "signature", "tone",
				"template_language", "default_sender", "max_leads_per_run",
				"max_per_niche", "daily_send_cap", "default_regions",
				"respect_suppressions", "dedup_days", "require_niche_analysis"
			)
			SELECT
				o."id", w."default_template", w."signature", w."tone",
				w."template_language", w."default_sender", w."max_leads_per_run",
				w."max_per_niche", w."daily_send_cap",
				COALESCE(w."default_regions", '{}'::text[]),
				w."respect_suppressions", w."dedup_days", w."require_niche_analysis"
			FROM "organizations" o
			LEFT JOIN (SELECT * FROM "workflow_config" LIMIT 1) w ON true
			ON CONFLICT ("organization_id") DO NOTHING
		$bf$;
	END IF;
END $$;

ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "default_template";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "signature";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "tone";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "template_language";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "default_sender";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "max_leads_per_run";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "max_per_niche";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "daily_send_cap";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "default_regions";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "respect_suppressions";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "dedup_days";
ALTER TABLE "workflow_config" DROP COLUMN IF EXISTS "require_niche_analysis";

-- ----------------------------------------------------------------------------
-- 0027 — per-org signature-image asset store
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "signature_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"filename" text,
	"byte_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "signature_assets_organization_id_idx" ON "signature_assets" USING btree ("organization_id");
