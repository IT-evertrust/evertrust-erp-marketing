-- Per-organization email senders + a per-org sales calendar. `org_senders` holds
-- one row per from-address an org may send as; a campaign references one by its
-- stable `sender_key` (mirrors campaigns.sender), so the resolved address can
-- change without rewriting campaigns. UNIQUE (organization_id, sender_key) keeps a
-- key resolving to one address per org; many senders per org are allowed, so the
-- organization_id index is a plain (non-unique) btree. No rows are seeded — the API
-- resolver falls back to product defaults when an org has no senders, so no
-- evertrust-specific addresses are baked into the DB. Also adds the nullable
-- org_config.sales_calendar_id (null = product default). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "org_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sender_key" text NOT NULL,
	"email" text NOT NULL,
	"label" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_senders" ADD CONSTRAINT "org_senders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_senders_organization_id_sender_key_uq" ON "org_senders" USING btree ("organization_id","sender_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_senders_organization_id_idx" ON "org_senders" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sales_calendar_id" text;
