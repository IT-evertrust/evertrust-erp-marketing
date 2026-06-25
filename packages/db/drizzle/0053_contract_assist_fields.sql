-- Contract Assist (Nurture) display/draft fields on `contracts`: a self-contained,
-- editable snapshot (company, sector, value, deadline, type) plus the Read AI
-- analysis + key terms shown in the Company Analysis panel. Additive + idempotent
-- (hand-authored — the drizzle meta/ snapshot chain is incomplete; the migrator
-- applies this from the journal + SQL directly).
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "company" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "sector" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "contract_value" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "deadline" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "contract_type" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "analysis" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "terms" jsonb DEFAULT '[]'::jsonb NOT NULL;
