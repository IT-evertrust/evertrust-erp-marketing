-- Nurture pipeline card edits: prospects.phone (contact phone) + prospects.niche
-- (the editable "PV" niche-tag name, chosen from the Sector/niche taxonomy and
-- stored denormalized like contracts.sector). Additive + idempotent (hand-authored
-- — the drizzle meta/ snapshot chain is incomplete; the migrator applies this from
-- the journal + SQL directly).
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "niche" text;
