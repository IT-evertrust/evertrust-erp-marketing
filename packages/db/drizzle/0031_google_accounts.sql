-- Per-organization connected Google accounts. One row per Google account an org has
-- connected via the OAuth authorization-code flow — many per org (one per ERP user,
-- carrying that user's role). Distinct from the GIS login (identity only, no API
-- access): these rows hold real, AES-256-GCM-encrypted OAuth tokens for Gmail/Calendar
-- API calls scoped to the connecting org. Refresh tokens are stored as ciphertext —
-- plaintext NEVER hits the DB. UNIQUE (organization_id, google_sub) keeps an account
-- connected at most once per org; the organization_id index is a plain (non-unique)
-- btree because many accounts per org are allowed. Also adds the nullable
-- org_config.default_gmail_account_id / default_calendar_account_id pointers and the
-- nullable org_senders.google_account_id (null = bare alias as today), all →
-- google_accounts.id. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'CONNECTED' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_accounts_org_sub_uq" ON "google_accounts" USING btree ("organization_id","google_sub");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_accounts_organization_id_idx" ON "google_accounts" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "default_gmail_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "default_calendar_account_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_config" ADD CONSTRAINT "org_config_default_gmail_account_id_google_accounts_id_fk" FOREIGN KEY ("default_gmail_account_id") REFERENCES "public"."google_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_config" ADD CONSTRAINT "org_config_default_calendar_account_id_google_accounts_id_fk" FOREIGN KEY ("default_calendar_account_id") REFERENCES "public"."google_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "org_senders" ADD COLUMN IF NOT EXISTS "google_account_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_senders" ADD CONSTRAINT "org_senders_google_account_id_google_accounts_id_fk" FOREIGN KEY ("google_account_id") REFERENCES "public"."google_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
