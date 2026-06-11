CREATE TYPE "public"."arsenal_run_source" AS ENUM('MANUAL', 'SCHEDULED');--> statement-breakpoint
CREATE TYPE "public"."arsenal_run_status" AS ENUM('DISPATCHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."arsenal_stage" AS ENUM('LEAD_SATELLITE', 'AMMO_FORGE', 'REACH_BAZOOKA', 'REPLY_GLOCK', 'SLEEPER_GRENADE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arsenal_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"stage" "arsenal_stage" NOT NULL,
	"campaign_id" uuid,
	"source" "arsenal_run_source" NOT NULL,
	"status" "arsenal_run_status" NOT NULL,
	"detail" text,
	"triggered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arsenal_runs" ADD CONSTRAINT "arsenal_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arsenal_runs" ADD CONSTRAINT "arsenal_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arsenal_runs" ADD CONSTRAINT "arsenal_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arsenal_runs_organization_id_idx" ON "arsenal_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arsenal_runs_campaign_id_idx" ON "arsenal_runs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arsenal_runs_stage_idx" ON "arsenal_runs" USING btree ("stage");