-- Configuration page rebuild: single org-default mailbox + per-org AI engine.
-- Adds three NULLABLE org_config columns. default_mailbox_account_id is the SINGLE
-- org-default Google mailbox used for BOTH Gmail send and Calendar — it replaces the
-- two-pointer default_gmail/default_calendar model at the app layer (those columns
-- stay in place for back-compat but are no longer read). ai_model / ai_gateway hold
-- the per-org AI engine preference (null = product default). Additive + idempotent.
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "default_mailbox_account_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_config" ADD CONSTRAINT "org_config_default_mailbox_account_id_google_accounts_id_fk" FOREIGN KEY ("default_mailbox_account_id") REFERENCES "public"."google_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "ai_model" text;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "ai_gateway" text;
