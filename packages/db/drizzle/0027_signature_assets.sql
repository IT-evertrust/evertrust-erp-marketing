-- Per-organization signature image assets. Stores uploaded signature images so an
-- org can embed a hosted image in outgoing emails without depending on an external
-- Drive/lh3 link (org_config.signature_image_url can then point at an API-served URL
-- backed by one of these rows). The image bytes are kept as base64 TEXT (data_base64)
-- rather than bytea: simple + portable across the prod / per-dev / litellm Postgres
-- instances. Many assets per org are allowed, so the organization_id index is a plain
-- (non-unique) btree. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "signature_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"filename" text,
	"byte_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_assets_organization_id_idx" ON "signature_assets" USING btree ("organization_id");
