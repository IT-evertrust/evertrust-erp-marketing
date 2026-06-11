-- n8n→ERP run callback: autonomous n8n stage runs report their final outcome back
-- so they appear in the per-campaign Live activity feed. Adds the N8N source and
-- the SUCCESS / ERROR outcome values. ADD VALUE is idempotent (IF NOT EXISTS) and
-- only ADDS values (never uses them here), so it is safe inside the migration txn.
ALTER TYPE "public"."arsenal_run_source" ADD VALUE IF NOT EXISTS 'N8N';--> statement-breakpoint
ALTER TYPE "public"."arsenal_run_status" ADD VALUE IF NOT EXISTS 'SUCCESS';--> statement-breakpoint
ALTER TYPE "public"."arsenal_run_status" ADD VALUE IF NOT EXISTS 'ERROR';
