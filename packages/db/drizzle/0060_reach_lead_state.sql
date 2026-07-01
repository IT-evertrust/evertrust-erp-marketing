-- Reach lead state / region (for Germany, the Bundesland) captured by the scrape,
-- driving per-state coverage + the lead table's state tabs. Additive + idempotent.
ALTER TABLE "reach_leads" ADD COLUMN IF NOT EXISTS "state" text;
