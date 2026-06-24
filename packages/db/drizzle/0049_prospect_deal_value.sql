-- Nurture pipeline deal value (Phase 9): a per-prospect € amount, inline-edited on the
-- Nurture board + rolled up into per-column totals. Additive + idempotent. Default 0.
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "deal_value" integer DEFAULT 0 NOT NULL;
