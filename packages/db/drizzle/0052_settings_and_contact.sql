-- Settings page (org_config): sender identity, sending parameters, integration
-- toggles, and engine-mode toggles. Plus prospects.contact_name for the Nurture
-- pipeline card. Additive + idempotent (safe on a boot-time re-run and on a
-- push-managed DB). Hand-authored because the repo's drizzle meta/ snapshot chain
-- is incomplete (0005–0051 snapshots were never committed), which blocks
-- drizzle-kit generate; the migrator applies this from the journal + SQL directly.
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_name" text;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sender_name" text;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sender_email" text;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sending_hours_start" text NOT NULL DEFAULT '08:00';--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sending_hours_end" text NOT NULL DEFAULT '17:00';--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "followup_round2_days" integer NOT NULL DEFAULT 4;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "followup_round3_days" integer NOT NULL DEFAULT 9;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "gmail_enabled" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "calendar_enabled" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "read_ai_enabled" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sheets_enabled" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "approval_before_sending" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "auto_send" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "weekly_report_enabled" boolean NOT NULL DEFAULT true;
