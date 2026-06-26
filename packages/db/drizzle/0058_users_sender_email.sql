-- Per-user sender EMAIL, completing the per-user Sender Identity (name + signature +
-- image landed in 0057). Each user's own From address shown on outgoing Reach mail —
-- so it stops being an org-shared field that only reflects whoever saved last.
-- Additive + idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sender_email" text;
