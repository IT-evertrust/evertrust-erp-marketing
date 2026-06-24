-- Per-org Reach send policy (Phase 7): override the env defaults from the Settings
-- page without a redeploy. reach_send_mode ('test'|'live'), reach_test_recipient
-- (inbox test-mode is redirected to), reach_test_send_cap (max test sends per run).
-- Null on any column = fall back to the env default. Additive + idempotent. KEEPS
-- scrape_timeout_minutes (finalized dropped it; this branch does not).
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "reach_send_mode" text;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "reach_test_recipient" text;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "reach_test_send_cap" integer;
