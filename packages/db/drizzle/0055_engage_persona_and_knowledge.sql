-- Engage rework (per-email persona override + knowledge base). Additive +
-- idempotent (safe on a boot-time re-run and on a push-managed DB). Hand-authored
-- because the repo's drizzle meta/ snapshot chain is incomplete (0005+ snapshots
-- were never committed), which blocks drizzle-kit generate; the migrator applies
-- this from the journal + SQL directly.

-- ---- reach_lead_replies: per-email drafting persona OVERRIDE ----
-- null = use the campaign's persona (or the default Hanna voice). Set when the
-- operator picks a persona for one specific reply in the reply detail.
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "persona_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_persona_id_personas_id_fk"
    FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ---- knowledge_documents: Engage knowledge base for UNSURE grounding ----
-- Company documents (PDF/Word/sheets/text/scanned images) whose extracted text is
-- searched (Postgres full-text) when a reply is classified UNSURE, so the drafter
-- can ground a reply on real company info with citations.
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "extracted_text" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'READY' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_org_idx" ON "knowledge_documents" USING btree ("organization_id");--> statement-breakpoint
-- Full-text search index over the extracted text (drives UNSURE retrieval).
CREATE INDEX IF NOT EXISTS "knowledge_documents_fts_idx" ON "knowledge_documents" USING gin (to_tsvector('english', "extracted_text"));
