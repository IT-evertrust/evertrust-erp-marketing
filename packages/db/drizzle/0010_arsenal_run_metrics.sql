-- Marketing report (Phase 2): per-run funnel counts an n8n stage reports via the
-- callback (e.g. { "emailsSent": 40 }). Nullable + additive — safe on the live DB,
-- ignored by older code until the report/callback ship.
ALTER TABLE "arsenal_runs" ADD COLUMN IF NOT EXISTS "metrics" jsonb;
