ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "drive_missing" boolean DEFAULT false NOT NULL;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "drive_checked_at" timestamp with time zone;
