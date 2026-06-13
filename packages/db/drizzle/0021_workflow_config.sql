-- Growth-Engine workflow config: a GLOBAL, app-wide SINGLETON row that lets
-- admins override the env-only workflow wiring (n8n webhook URLs, n8n API base,
-- the ingest token, and the sequence offsets) from the ERP. Single-tenant today,
-- so there is no organization_id. The single row is enforced by the `singleton`
-- boolean + its unique constraint (the find-or-create target). Every override is
-- NULLABLE (null = fall back to the env var). Secrets are not stored: the n8n API
-- key stays in env; the ingest token is kept only as a SHA-256 hex digest.

CREATE TABLE IF NOT EXISTS "workflow_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"aim_webhook_url" text,
	"lead_satellite_webhook_url" text,
	"ammo_forge_webhook_url" text,
	"reach_bazooka_webhook_url" text,
	"reply_glock_webhook_url" text,
	"sleeper_grenade_webhook_url" text,
	"n8n_api_url" text,
	"ingest_token_hash" text,
	"ingest_token_set_at" timestamp with time zone,
	"default_sender" text,
	"followup_offset_days" integer,
	"final_push_offset_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_config_singleton_uq" ON "workflow_config" USING btree ("singleton");
