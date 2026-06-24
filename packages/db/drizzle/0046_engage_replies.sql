-- Engage agent inbox pipeline (Phase 0/1): persisted reply classifications + "teach
-- the AI" training memory, the Engage drafting persona link on aims, and the Gmail
-- real-time scan state + account color on connected Google accounts. Purely additive
-- + idempotent — nothing here touches the prospects/Nurture read path or the async
-- scrape/reconcile columns this branch keeps.

-- ---- reach_aims: Engage drafting persona (reply_glock voice) ----
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "persona_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reach_aims" ADD CONSTRAINT "reach_aims_persona_id_personas_id_fk"
    FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ---- google_accounts: account color + Engage real-time scan state ----
ALTER TABLE "google_accounts" ADD COLUMN IF NOT EXISTS "color" text;--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN IF NOT EXISTS "gmail_history_id" text;--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN IF NOT EXISTS "gmail_watch_expiration" timestamp with time zone;--> statement-breakpoint

-- ---- reach_lead_replies: one persisted classification per (aim, lead) ----
CREATE TABLE IF NOT EXISTS "reach_lead_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "aim_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
  "gmail_thread_id" text,
  "category" text NOT NULL,
  "confidence" double precision,
  "reasoning" text,
  "recommended_action" text,
  "inbound_subject" text,
  "inbound_body" text,
  "draft_subject" text,
  "draft_body" text,
  "draft_source" text,
  "citations" jsonb,
  "thread" jsonb,
  "follow_up_window" text,
  "handled" boolean DEFAULT false NOT NULL,
  "sent_at" timestamp with time zone,
  "classified_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_aim_id_reach_aims_id_fk"
    FOREIGN KEY ("aim_id") REFERENCES "public"."reach_aims"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_lead_id_reach_leads_id_fk"
    FOREIGN KEY ("lead_id") REFERENCES "public"."reach_leads"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reach_lead_replies_aim_lead_uq" ON "reach_lead_replies" USING btree ("aim_id","lead_id");--> statement-breakpoint

-- ---- engage_training: "teach the AI" notes (campaign-scoped or org-wide) ----
CREATE TABLE IF NOT EXISTS "engage_training" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "aim_id" uuid,
  "note" text NOT NULL,
  "source" text DEFAULT 'feedback' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "engage_training" ADD CONSTRAINT "engage_training_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "engage_training" ADD CONSTRAINT "engage_training_aim_id_reach_aims_id_fk"
    FOREIGN KEY ("aim_id") REFERENCES "public"."reach_aims"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engage_training_org_aim_idx" ON "engage_training" USING btree ("organization_id","aim_id");
