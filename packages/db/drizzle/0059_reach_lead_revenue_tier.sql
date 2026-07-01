-- Reach lead revenue tier (AA/A/B/C) captured by the scrape. Additive + idempotent.
ALTER TABLE "reach_leads" ADD COLUMN IF NOT EXISTS "revenue_tier" text;
