CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'DEPLOYED', 'FAILED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text,
	"niche" text NOT NULL,
	"target" text NOT NULL,
	"country" text NOT NULL,
	"state" text NOT NULL,
	"project" text NOT NULL,
	"gmail_label" text NOT NULL,
	"sales_calendar_id" text NOT NULL,
	"whatsapp_number" text NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"drive_folder_id" text,
	"drive_folder_url" text,
	"deploy_error" text,
	"deployed_by" uuid,
	"deployed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_deployed_by_users_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_organization_id_idx" ON "campaigns" USING btree ("organization_id");