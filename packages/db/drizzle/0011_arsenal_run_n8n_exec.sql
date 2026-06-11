-- Backfill (option B): track which n8n execution a run was imported from, so
-- re-syncs are idempotent. Nullable + additive; unique index allows many NULLs
-- (ERP-dispatched / callback rows) but blocks importing the same execution twice.
ALTER TABLE "arsenal_runs" ADD COLUMN IF NOT EXISTS "n8n_execution_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arsenal_runs_n8n_execution_id_uq" ON "arsenal_runs" USING btree ("n8n_execution_id");
