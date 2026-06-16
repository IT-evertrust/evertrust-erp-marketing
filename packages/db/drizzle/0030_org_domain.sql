-- Per-org email domain as the join key for Google-login org auto-provisioning. A new
-- SSO user whose address ends in this domain joins the matching org instead of spawning
-- a duplicate. The column is NULLABLE; the UNIQUE index permits many NULLs (Postgres
-- treats NULLs as distinct in a unique index), so domain-less orgs coexist while a given
-- domain resolves to exactly one org. Backfill: stamp the existing EverTrust org with its
-- domain — resolved indirectly via the bootstrap admin (info@evertrust-germany.de) so we
-- never hardcode an org id — so future @evertrust-germany.de logins join it, not a new
-- duplicate. Additive + idempotent (column add, index create, and a guarded UPDATE).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "domain" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_domain_uq" ON "organizations" ("domain");
--> statement-breakpoint
UPDATE "organizations" SET "domain" = 'evertrust-germany.de' WHERE "domain" IS NULL AND "id" = (SELECT "organization_id" FROM "users" WHERE lower("email") = 'info@evertrust-germany.de' LIMIT 1);
