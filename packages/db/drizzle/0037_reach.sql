-- Reach (Growth Engine) DB layer: its own lean tables, separate from the
-- heavier campaigns/prospects pipeline. An "aim" is a Reach campaign (the AIM
-- input fields ARE the config.json; generated templates + news brief live on
-- the row). reach_leads are tied to an aim; reach_sends is one row per
-- (lead, round) — the source of truth for per-round stats. Idempotent: enums
-- use DO $$ ... duplicate_object guards, tables use CREATE TABLE IF NOT EXISTS.

DO $$ BEGIN
 CREATE TYPE "public"."reach_aim_status" AS ENUM('DRAFT', 'READY', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."reach_lead_status" AS ENUM('NEW', 'COLD_OUTREACHED', 'FOLLOWED_UP', 'INTERESTED', 'UNSURE', 'NOT_INTERESTED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."reach_round" AS ENUM('cold', 'followup', 'final');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reach_aims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"niche" text NOT NULL,
	"region" text NOT NULL,
	"segment" text,
	"source" text,
	"sender" text DEFAULT 'info' NOT NULL,
	"status" "reach_aim_status" DEFAULT 'DRAFT' NOT NULL,
	"templates" jsonb,
	"news_brief" jsonb,
	"stats" jsonb,
	"generated_by" text,
	"auto_send" boolean DEFAULT false NOT NULL,
	"companies" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_aims" ADD CONSTRAINT "reach_aims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reach_aims_organization_id_idx" ON "reach_aims" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reach_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"aim_id" uuid NOT NULL,
	"company" text NOT NULL,
	"website" text,
	"contact_name" text,
	"contact_title" text,
	"email" text,
	"phone" text,
	"location" text,
	"source" text,
	"qualification_reason" text,
	"confidence" double precision,
	"status" "reach_lead_status" DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_leads" ADD CONSTRAINT "reach_leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_leads" ADD CONSTRAINT "reach_leads_aim_id_reach_aims_id_fk" FOREIGN KEY ("aim_id") REFERENCES "public"."reach_aims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reach_leads_aim_id_idx" ON "reach_leads" USING btree ("aim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reach_leads_organization_id_idx" ON "reach_leads" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reach_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"aim_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"round" "reach_round" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_sends" ADD CONSTRAINT "reach_sends_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_sends" ADD CONSTRAINT "reach_sends_aim_id_reach_aims_id_fk" FOREIGN KEY ("aim_id") REFERENCES "public"."reach_aims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_sends" ADD CONSTRAINT "reach_sends_lead_id_reach_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."reach_leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reach_sends_lead_round_uq" ON "reach_sends" USING btree ("lead_id","round");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reach_sends_aim_id_idx" ON "reach_sends" USING btree ("aim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reach_sends_organization_id_idx" ON "reach_sends" USING btree ("organization_id");
