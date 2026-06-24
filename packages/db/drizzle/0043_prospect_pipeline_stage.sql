-- Human sales-pipeline stage on prospects (the Nurture board, drag-and-drop). A
-- SEPARATE axis from prospect_status. Additive + idempotent (safe to re-run).
DO $$ BEGIN
  CREATE TYPE "public"."pipeline_stage" AS ENUM('INTEREST','INTENT','CONSIDERATION','DECISION','WON','LOST');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "pipeline_stage" "public"."pipeline_stage" NOT NULL DEFAULT 'INTEREST';--> statement-breakpoint
-- One-time seed: derive a sensible starting stage from the existing outreach status
-- so the board isn't entirely in column 1 on day one. Guarded to rows still at the
-- default, so a partial-retry of this migration never re-stamps a hand-moved card.
UPDATE "prospects" SET "pipeline_stage" = (CASE
  WHEN "status" = 'INTERESTED' THEN 'CONSIDERATION'
  WHEN "status" = 'MEETING_SCHEDULED' THEN 'DECISION'
  WHEN "status" IN ('NOT_INTERESTED','DO_NOT_CONTACT') THEN 'LOST'
  ELSE 'INTEREST'
END)::"public"."pipeline_stage"
WHERE "pipeline_stage" = 'INTEREST';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_pipeline_stage_idx" ON "prospects" USING btree ("pipeline_stage");
