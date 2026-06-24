-- Migration-chain repair for the Engage replies module (schema/engage-replies.ts).
--
-- reach_lead_replies + engage_training were created via drizzle-kit `push` on the
-- local/prod DB, so no CREATE migration ever existed for them — yet 0041 ALTERs
-- reach_lead_replies. On a clean `migrate` target (the jest Testcontainer / a fresh
-- prod) the table didn't exist, so 0041 was guarded to no-op and the table was never
-- created at all. This migration creates both tables idempotently AFTER 0041:
--   * clean target  -> 0041's guard no-ops, then this CREATE builds the full table
--                       (meeting-loop columns included), so specs have a real table.
--   * push-managed DB -> tables already exist, so CREATE TABLE IF NOT EXISTS and the
--                       guarded ADD CONSTRAINT / CREATE INDEX IF NOT EXISTS all no-op.
-- Style mirrors 0037_reach.sql: IF NOT EXISTS tables, DO $$ ... duplicate_object FK
-- guards, idempotent indexes.

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
	"proposed_slots" jsonb,
	"meeting_status" text DEFAULT 'NONE' NOT NULL,
	"accepted_slot" jsonb,
	"booked_meeting_id" uuid,
	"handled" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_aim_id_reach_aims_id_fk" FOREIGN KEY ("aim_id") REFERENCES "public"."reach_aims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_lead_id_reach_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."reach_leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_booked_meeting_id_meetings_id_fk" FOREIGN KEY ("booked_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reach_lead_replies_aim_lead_uq" ON "reach_lead_replies" USING btree ("aim_id","lead_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "engage_training" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"aim_id" uuid,
	"note" text NOT NULL,
	"source" text DEFAULT 'feedback' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "engage_training" ADD CONSTRAINT "engage_training_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "engage_training" ADD CONSTRAINT "engage_training_aim_id_reach_aims_id_fk" FOREIGN KEY ("aim_id") REFERENCES "public"."reach_aims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engage_training_org_aim_idx" ON "engage_training" USING btree ("organization_id","aim_id");
