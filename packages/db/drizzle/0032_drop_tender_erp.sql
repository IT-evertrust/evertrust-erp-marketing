-- Tender/Pricing ERP teardown. Removes the entire tender domain — the tenders root,
-- its document/amendment/assignment children, the pricing engine tables (line_items,
-- pricings, price_observations, rfqs), the process tables (approval_requests,
-- compliance_checks, doc_packages, submission_receipts) and tender_contributions —
-- plus the tender_id back-references on the kept observability tables and the enum
-- types used ONLY by those tables. KEEPS customers + contracts (growth funnel + Nurture)
-- and users/organizations and every growth/campaign/lead/meeting/outreach/niche/PMS table.
-- Fully guarded + idempotent (IF EXISTS everywhere); child-before-parent drop order so the
-- tenders FKs never block. The pgvector extension created in 0000 is untouched.

-- (a) Strip the tender_id back-references on the kept observability tables first.
ALTER TABLE "workflow_executions" DROP CONSTRAINT IF EXISTS "workflow_executions_tender_id_tenders_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "workflow_executions_tender_id_idx";--> statement-breakpoint
ALTER TABLE "workflow_executions" DROP COLUMN IF EXISTS "tender_id";--> statement-breakpoint
ALTER TABLE "ai_runs" DROP CONSTRAINT IF EXISTS "ai_runs_tender_id_tenders_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "ai_runs_tender_id_idx";--> statement-breakpoint
ALTER TABLE "ai_runs" DROP COLUMN IF EXISTS "tender_id";--> statement-breakpoint

-- (b) Drop the tender-domain tables, children before parents (a DROP TABLE also drops
-- that table's own indexes + FK constraints, so only the order matters here).
DROP TABLE IF EXISTS "price_observations";--> statement-breakpoint
DROP TABLE IF EXISTS "rfqs";--> statement-breakpoint
DROP TABLE IF EXISTS "pricings";--> statement-breakpoint
DROP TABLE IF EXISTS "line_items";--> statement-breakpoint
DROP TABLE IF EXISTS "approval_requests";--> statement-breakpoint
DROP TABLE IF EXISTS "compliance_checks";--> statement-breakpoint
DROP TABLE IF EXISTS "doc_packages";--> statement-breakpoint
DROP TABLE IF EXISTS "submission_receipts";--> statement-breakpoint
DROP TABLE IF EXISTS "amendments";--> statement-breakpoint
DROP TABLE IF EXISTS "assignments";--> statement-breakpoint
DROP TABLE IF EXISTS "tender_contributions";--> statement-breakpoint
DROP TABLE IF EXISTS "documents";--> statement-breakpoint
DROP TABLE IF EXISTS "tenders";--> statement-breakpoint
DROP TABLE IF EXISTS "suppliers";--> statement-breakpoint

-- (c) Drop the enum types used ONLY by the now-removed tables.
DROP TYPE IF EXISTS "public"."tender_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."tender_regime";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."document_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."ocr_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."price_obs_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."pricing_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."approval_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."approval_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."rfq_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."contribution_role";
