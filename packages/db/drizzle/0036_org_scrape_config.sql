-- Per-org Lead Scraper tuning (Configuration page → satellite agent). Adds three
-- NULLABLE org_config columns so an admin can tune the scraper per org without editing
-- the agent's .env: scrape_lead_target (how many leads to hunt), scrape_max_queries
-- (search budget — speed vs coverage), scrape_min_score (the tier-floor that drops
-- low-relevance leads). Null = the agent's own env default
-- (LEAD_TARGET / LEAD_MAX_QUERIES / LEAD_MIN_KEEP_SCORE). Additive + idempotent.
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "scrape_lead_target" integer;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "scrape_max_queries" integer;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "scrape_min_score" integer;
