ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "read_ai_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "summary" text;
