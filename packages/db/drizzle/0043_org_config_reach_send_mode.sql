-- Per-org Reach send policy (Settings page → delivery runs). These three NULLABLE
-- org_config columns were added to the Drizzle schema (schema/org-config.ts) and
-- applied to local/prod via drizzle-kit `push`, but never captured as a migration —
-- so a clean `migrate` target (the jest Testcontainer) is missing them and every
-- spec that touches org_config dies with `column "reach_send_mode" does not exist`.
-- This append-only migration backfills the gap. reach_send_mode is the per-org
-- override of env REACH_SEND_MODE: 'test' redirects every Reach email to
-- reach_test_recipient (capped by reach_test_send_cap) with a banner so real leads
-- are never hit; 'live' sends to the real lead email. Null = fall back to env
-- (default 'test'). reach_test_recipient (null = env REACH_TEST_RECIPIENT) and
-- reach_test_send_cap (null = env REACH_TEST_SEND_CAP) tune the test redirect.
-- Additive + idempotent so a boot-time re-run (api-start.sh) is safe.
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "reach_send_mode" text;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "reach_test_recipient" text;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "reach_test_send_cap" integer;
