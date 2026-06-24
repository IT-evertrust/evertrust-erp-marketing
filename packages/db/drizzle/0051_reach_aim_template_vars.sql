-- Per-campaign template placeholders for the org default outreach template:
--   {{Type}} -> target_type, {{IndustryFocus}} -> industry_focus,
--   {{TenderFocus}} -> tender_focus (resolver falls back to niche when null).
-- Additive + idempotent (safe on a boot-time re-run and on a push-managed DB).
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "target_type" text;--> statement-breakpoint
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "industry_focus" text;--> statement-breakpoint
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "tender_focus" text;
