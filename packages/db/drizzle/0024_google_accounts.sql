-- Per-user Google OAuth grant: "Sign in with Google" + acting on the user's behalf
-- (Gmail send, Calendar). One row per user (user_id is PK + FK -> users). The refresh
-- token is stored ENCRYPTED at rest; access_token is a short-lived cache refreshed on
-- demand. Fully additive + idempotent (CREATE TABLE IF NOT EXISTS, FK guarded by a
-- pg_constraint check), so a re-run on an already-migrated DB is a no-op.

CREATE TABLE IF NOT EXISTS "google_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"scope" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'google_accounts_user_id_users_id_fk'
	) THEN
		ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
	END IF;
END $$;
