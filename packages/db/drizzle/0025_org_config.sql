-- Per-organization config (multi-tenant SaaS). One row per org for the
-- customer-facing outreach prefs (templates, signature + image, tone, language,
-- default sender, lead governance). Platform infra (n8n webhooks, API base,
-- ingest token, offsets) stays in the GLOBAL workflow_config singleton.
-- Additive + idempotent. A FOLLOW-UP migration backfills each org's row from the
-- existing global workflow_config prefs and drops those columns from it.
CREATE TABLE IF NOT EXISTS "org_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"default_template" jsonb,
	"signature" text,
	"signature_image_url" text,
	"tone" text,
	"template_language" text,
	"default_sender" text,
	"max_leads_per_run" integer,
	"max_per_niche" integer,
	"daily_send_cap" integer,
	"default_regions" text[] DEFAULT '{}'::text[],
	"respect_suppressions" boolean,
	"dedup_days" integer,
	"require_niche_analysis" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_config" ADD CONSTRAINT "org_config_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_config_organization_id_uq" ON "org_config" USING btree ("organization_id");
