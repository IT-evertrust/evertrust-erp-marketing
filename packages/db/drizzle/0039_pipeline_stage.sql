-- Sales-pipeline data model for the Nurture kanban board. Additive and
-- independent of prospects.status (the cold-outreach funnel projection):
-- pipeline_stage is the kanban column, deal_value the deal size in whole euros,
-- contact_name / contact_phone the named point of contact. Idempotent: the enum
-- uses a DO $$ ... duplicate_object guard, the columns use ADD COLUMN IF NOT EXISTS.

DO $$ BEGIN
 CREATE TYPE "public"."pipeline_stage" AS ENUM('INTEREST', 'INTENT', 'CONSIDERATION', 'DECISION', 'WON', 'LOST');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "pipeline_stage" "pipeline_stage" DEFAULT 'INTEREST' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "deal_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_name" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "contact_phone" text;
