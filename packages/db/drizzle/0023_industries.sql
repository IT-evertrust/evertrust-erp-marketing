-- Adds an Industry grouping layer above niches. An industry groups niches
-- (one industry → many niches; a niche belongs to at most one industry).
-- Org-scoped, used for grouping/search only — NOT referenced by lead research.
-- `industries` mirrors `niches` (slug is the lower/trim dedup key). The new
-- niches.industry_id is NULLABLE (existing niches have none; assignment is
-- gradual). Fully additive and idempotent: CREATE TABLE / ADD COLUMN IF NOT
-- EXISTS, indexes IF NOT EXISTS, and the FK guarded by a pg_constraint check,
-- so a re-run on an already-migrated DB is a no-op.

CREATE TABLE IF NOT EXISTS "industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "industries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "industries_organization_id_slug_uq" ON "industries" ("organization_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "industries_organization_id_idx" ON "industries" ("organization_id");--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "industry_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'niches_industry_id_industries_id_fk'
	) THEN
		ALTER TABLE "niches" ADD CONSTRAINT "niches_industry_id_industries_id_fk" FOREIGN KEY ("industry_id") REFERENCES "industries"("id");
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "niches_industry_id_idx" ON "niches" ("industry_id");
