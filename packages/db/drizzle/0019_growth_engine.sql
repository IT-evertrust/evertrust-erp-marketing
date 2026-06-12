-- Growth-Engine v2: niche vocabulary (niches/niche_targets), prospects pipeline
-- (prospects/suppressions), outreach ledger (outreach_messages/
-- reply_classifications), contracts, notifications, campaign_assets + the
-- campaigns refactor (state->region & deployed->activated RENAMEs preserve
-- data; lifecycle replaces the deploy status; Drive demoted to artifact
-- pointers). Contains data backfills — ORDER MATTERS: creates first, then
-- backfills, then the SET NOT NULL and the drops. Runs in one migration
-- transaction, so a failure rolls back cleanly.

CREATE TYPE "public"."campaign_state" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."niche_target_source" AS ENUM('AI', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."prospect_status" AS ENUM('NEW', 'EMAILED', 'REPLIED', 'INTERESTED', 'MEETING_SCHEDULED', 'NOT_INTERESTED', 'RE_ENGAGED', 'DO_NOT_CONTACT');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('OUTBOUND', 'INBOUND');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('SENT', 'FAILED', 'BOUNCED', 'RECEIVED');--> statement-breakpoint
CREATE TYPE "public"."reply_verdict" AS ENUM('INTERESTED', 'NOT_INTERESTED', 'SNOOZE', 'MEETING_REQUEST', 'UNSURE', 'AUTO_REPLY', 'BOUNCE');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('EMAIL_TEMPLATE', 'NEWS_BRIEF', 'NICHE_ANALYSIS', 'COACH_REPORT', 'CONTRACT_TEMPLATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('GENERATED', 'SENT', 'SIGNED', 'FAILED');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "niches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "niches" ADD CONSTRAINT "niches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "niches_organization_id_slug_uq" ON "niches" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "niches_organization_id_idx" ON "niches" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "niche_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"search_hint" text,
	"source" "niche_target_source" DEFAULT 'AI' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "niche_targets" ADD CONSTRAINT "niche_targets_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "niche_targets" ADD CONSTRAINT "niche_targets_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "niche_targets_niche_id_slug_uq" ON "niche_targets" USING btree ("niche_id","slug");--> statement-breakpoint

-- campaigns refactor. RENAMEs (not drop+add) so existing data survives.
ALTER TABLE "campaigns" RENAME COLUMN "state" TO "region";--> statement-breakpoint
ALTER TABLE "campaigns" RENAME COLUMN "deployed_by" TO "activated_by";--> statement-breakpoint
ALTER TABLE "campaigns" RENAME COLUMN "deployed_at" TO "activated_at";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "niche_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "sender" text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "lifecycle" "campaign_state" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_niche_id_idx" ON "campaigns" USING btree ("niche_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_lifecycle_idx" ON "campaigns" USING btree ("lifecycle");--> statement-breakpoint
ALTER TABLE "arsenal_runs" ADD COLUMN IF NOT EXISTS "config_snapshot" jsonb;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"name" text NOT NULL,
	"drive_file_id" text NOT NULL,
	"drive_url" text,
	"mime_type" text,
	"version" integer DEFAULT 1 NOT NULL,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_assets_drive_file_id_uq" ON "campaign_assets" USING btree ("drive_file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_assets_campaign_id_idx" ON "campaign_assets" USING btree ("campaign_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"niche_target_id" uuid,
	"email" text NOT NULL,
	"company_name" text,
	"website" text,
	"city" text,
	"country" text,
	"source_url" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"status" "prospect_status" DEFAULT 'NEW' NOT NULL,
	"snooze_until" timestamp with time zone,
	"followup_count" integer DEFAULT 0 NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospects" ADD CONSTRAINT "prospects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospects" ADD CONSTRAINT "prospects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospects" ADD CONSTRAINT "prospects_niche_target_id_niche_targets_id_fk" FOREIGN KEY ("niche_target_id") REFERENCES "public"."niche_targets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospects" ADD CONSTRAINT "prospects_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospects_campaign_id_email_uq" ON "prospects" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_organization_id_idx" ON "prospects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_status_idx" ON "prospects" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_snooze_until_idx" ON "prospects" USING btree ("snooze_until");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" text,
	"source_prospect_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_source_prospect_id_prospects_id_fk" FOREIGN KEY ("source_prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppressions_organization_id_email_uq" ON "suppressions" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppressions_organization_id_idx" ON "suppressions" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"status" "message_status" NOT NULL,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"subject" text,
	"body_snippet" text,
	"template_asset_id" uuid,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_template_asset_id_campaign_assets_id_fk" FOREIGN KEY ("template_asset_id") REFERENCES "public"."campaign_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_messages_gmail_message_id_uq" ON "outreach_messages" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_messages_prospect_id_idx" ON "outreach_messages" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_messages_gmail_thread_id_idx" ON "outreach_messages" USING btree ("gmail_thread_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reply_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"message_id" uuid,
	"verdict" "reply_verdict" NOT NULL,
	"snooze_until" timestamp with time zone,
	"model" text,
	"raw" jsonb,
	"suggested_reply" text,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reply_classifications" ADD CONSTRAINT "reply_classifications_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reply_classifications" ADD CONSTRAINT "reply_classifications_message_id_outreach_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outreach_messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reply_classifications" ADD CONSTRAINT "reply_classifications_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reply_classifications_prospect_id_idx" ON "reply_classifications" USING btree ("prospect_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"customer_id" uuid,
	"campaign_id" uuid,
	"template_asset_id" uuid,
	"signing_meeting_id" uuid,
	"status" "contract_status" DEFAULT 'GENERATED' NOT NULL,
	"drive_file_id" text,
	"drive_url" text,
	"cooperation_term" text,
	"signed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_asset_id_campaign_assets_id_fk" FOREIGN KEY ("template_asset_id") REFERENCES "public"."campaign_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_signing_meeting_id_meetings_id_fk" FOREIGN KEY ("signing_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_organization_id_idx" ON "contracts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_lead_id_idx" ON "contracts" USING btree ("lead_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_organization_id_idx" ON "notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_organization_id_read_at_idx" ON "notifications" USING btree ("organization_id","read_at");--> statement-breakpoint

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "niche_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ==== Backfills (legacy free-text columns are still present here) ====
-- 1) Seed the niche vocabulary from the legacy campaign + lead free-text niches.
--    slug = lower(trim()) is the dedup key; the first variant wins the display name.
INSERT INTO "niches" ("organization_id", "name", "slug")
SELECT DISTINCT ON (src."organization_id", lower(trim(src."niche")))
	src."organization_id", trim(src."niche"), lower(trim(src."niche"))
FROM (
	SELECT "organization_id", "niche" FROM "campaigns" WHERE trim(coalesce("niche", '')) <> ''
	UNION ALL
	SELECT "organization_id", "niche" FROM "leads" WHERE trim(coalesce("niche", '')) <> ''
) src
ORDER BY src."organization_id", lower(trim(src."niche"))
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 2) Link every campaign to its niche by slug.
UPDATE "campaigns" c SET "niche_id" = n."id"
FROM "niches" n
WHERE n."organization_id" = c."organization_id" AND n."slug" = lower(trim(c."niche"));--> statement-breakpoint
-- 3) Safety net: legacy campaigns with a blank/whitespace niche get a per-org
--    'uncategorized' niche so the SET NOT NULL below cannot fail.
INSERT INTO "niches" ("organization_id", "name", "slug")
SELECT DISTINCT c."organization_id", 'Uncategorized', 'uncategorized'
FROM "campaigns" c WHERE c."niche_id" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "campaigns" c SET "niche_id" = n."id"
FROM "niches" n
WHERE c."niche_id" IS NULL AND n."organization_id" = c."organization_id" AND n."slug" = 'uncategorized';--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "niche_id" SET NOT NULL;--> statement-breakpoint
-- 4) Preserve the old free-text campaign targets as MANUAL niche targets.
INSERT INTO "niche_targets" ("niche_id", "name", "slug", "source")
SELECT DISTINCT c."niche_id", trim(c."target"), lower(trim(c."target")), 'MANUAL'::"public"."niche_target_source"
FROM "campaigns" c
WHERE trim(coalesce(c."target", '')) <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 5) MANUAL (campaign-less) leads keep their niche via the new FK; campaign-
--    linked leads resolve theirs through the campaign and stay NULL here.
UPDATE "leads" l SET "niche_id" = n."id"
FROM "niches" n
WHERE l."campaign_id" IS NULL AND n."organization_id" = l."organization_id" AND n."slug" = lower(trim(l."niche"));--> statement-breakpoint
-- 6) Lifecycle from the old deploy status: DEPLOYED -> ACTIVE; DRAFT/FAILED ->
--    DRAFT (also the column default); Drive-reconcile casualties -> ARCHIVED.
UPDATE "campaigns" SET "lifecycle" = 'ACTIVE' WHERE "status" = 'DEPLOYED';--> statement-breakpoint
UPDATE "campaigns" SET "lifecycle" = 'DRAFT' WHERE "status" IN ('DRAFT', 'FAILED');--> statement-breakpoint
UPDATE "campaigns" SET "lifecycle" = 'ARCHIVED', "archived_at" = "drive_checked_at" WHERE "drive_missing" = true;--> statement-breakpoint

-- ==== Drops (only after the backfills above consumed the legacy columns) ====
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "niche";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "target";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "drive_missing";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "drive_checked_at";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "deploy_error";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "niche";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."campaign_status";
