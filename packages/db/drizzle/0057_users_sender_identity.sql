-- Per-user sender identity. Each user owns their own From display name, email
-- signature block, and signature image — these REPLACE the org-level defaults on
-- the send path (no org fallback). Additive + idempotent (safe to re-run).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sender_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signature" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signature_image_url" text;
