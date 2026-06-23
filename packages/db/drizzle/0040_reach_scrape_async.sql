ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "scrape_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "scrape_eta_seconds" integer;--> statement-breakpoint
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "scrape_last_seconds" integer;
