CREATE TYPE "public"."lead_stage" AS ENUM('INTERESTED', 'MEETING_SCHEDULED', 'CUSTOMER', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('N8N', 'MANUAL');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"company_name" text,
	"company_type" text,
	"website" text,
	"city" text,
	"country" text,
	"tier" text,
	"niche" text,
	"source_campaign" text,
	"campaign_id" uuid,
	"hot_reason" text,
	"lead_status" text,
	"meeting_date" text,
	"detected_at" timestamp with time zone,
	"note" text,
	"stage" "lead_stage" DEFAULT 'INTERESTED' NOT NULL,
	"customer_id" uuid,
	"source" "lead_source" DEFAULT 'N8N' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_organization_id_idx" ON "leads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_stage_idx" ON "leads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_campaign_id_idx" ON "leads" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_organization_id_email_uq" ON "leads" USING btree ("organization_id","email");
