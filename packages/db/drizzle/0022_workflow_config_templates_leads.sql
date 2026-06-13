-- Additive extension of the workflow_config singleton with two new
-- Configuration-page sections: Templates (global outreach defaults) and Leads
-- (lead-generation governance). Every column is NULLABLE (null = fall back to
-- the product default, resolved in the service layer). default_regions defaults
-- to an empty array. No existing columns are altered; idempotent via
-- ADD COLUMN IF NOT EXISTS so a re-run on an already-migrated DB is a no-op.

ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "default_template" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "signature" text;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "tone" text;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "template_language" text;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "max_leads_per_run" integer;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "max_per_niche" integer;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "daily_send_cap" integer;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "default_regions" text[] DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "respect_suppressions" boolean;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "dedup_days" integer;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD COLUMN IF NOT EXISTS "require_niche_analysis" boolean;
