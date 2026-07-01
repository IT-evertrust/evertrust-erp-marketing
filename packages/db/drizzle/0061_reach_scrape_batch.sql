-- Reach 4-batch dedup sweep: which batch (1..4) a campaign is on. Additive +
-- idempotent (safe on a boot-time re-run and on a push-managed DB).
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "scrape_batch" integer DEFAULT 1 NOT NULL;
