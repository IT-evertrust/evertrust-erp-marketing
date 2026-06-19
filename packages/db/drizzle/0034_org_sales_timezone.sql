-- Per-org sales-calendar timezones (multi-tenant Activate calendar). Adds two
-- NULLABLE org_config columns. sales_time_zone is the org's primary display/booking
-- IANA zone (null = product default env SALES_TIME_ZONE ?? 'Europe/Berlin');
-- sales_secondary_time_zone is the optional second zone for the Activate dual-scale
-- gutter (null = single-scale, no secondary gutter — no product default). Additive +
-- idempotent so a re-run (boot-time migrate) is safe.
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sales_time_zone" text;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "sales_secondary_time_zone" text;
--> statement-breakpoint
-- Preserve the existing EverTrust deployment's dual time-scale gutter (the prior
-- hardcoded GMT+7 / Asia/Bangkok secondary). Tenant-scoped to the bootstrap org by
-- slug, so this is a NO-OP for any other tenant or a fresh non-EverTrust deployment.
-- COALESCE keeps any value an admin later sets; ON CONFLICT handles a pre-existing row.
INSERT INTO "org_config" ("organization_id", "sales_secondary_time_zone")
SELECT "id", 'Asia/Bangkok' FROM "organizations" WHERE "slug" = 'evertrust'
ON CONFLICT ("organization_id") DO UPDATE
  SET "sales_secondary_time_zone" = COALESCE("org_config"."sales_secondary_time_zone", 'Asia/Bangkok');
