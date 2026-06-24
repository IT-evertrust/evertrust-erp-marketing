-- Activate · Client Research (Phase 4): persisted internal-data-grounded dossiers —
-- profile/signals/talking-points PLUS interaction context, history timeline, a
-- communication-style MBTI read, and deal economics. One row per (org, company).
-- Additive + idempotent. NOTE: the deal-value WRITE-BACK onto reach_leads (finalized's
-- Nurture-on-reach_leads model) is deliberately NOT included on this branch — the
-- dossier keeps its own deal columns; reach_leads stays untouched.
CREATE TABLE IF NOT EXISTS "client_research" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "company" text NOT NULL,
  "client_email" text,
  "lead_id" uuid,
  "campaign_id" uuid,
  "profile" jsonb,
  "signals" jsonb,
  "talking_points" jsonb,
  "interaction_context" text,
  "history" jsonb,
  "mbti" text,
  "mbti_confidence" double precision,
  "mbti_reasoning" text,
  "personality" jsonb,
  "business_metrics" jsonb,
  "stage" text DEFAULT 'PRE_MEETING' NOT NULL,
  "deal_value" double precision,
  "deal_currency" text,
  "deal_basis" text,
  "sources" jsonb,
  "status" text DEFAULT 'ready' NOT NULL,
  "generated_by" text,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_research" ADD CONSTRAINT "client_research_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_research_org_company_uq" ON "client_research" USING btree ("organization_id","company");
