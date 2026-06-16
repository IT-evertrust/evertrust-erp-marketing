-- ============================================================================
-- EverTrust — add the OWNER role on the LIVE Supabase DB.
-- Run in the Supabase SQL Editor in TWO SEPARATE executions: Postgres will not
-- let you ADD an enum value and USE it in the same transaction (the SQL editor
-- runs a multi-statement script as one transaction, so run them one at a time).
--
-- Local/Docker is already handled by Drizzle migration 0024
-- (packages/db/drizzle/0024_user_role_owner.sql) via `db:migrate` — this file is
-- only for updating Supabase by hand.
-- ============================================================================

-- ── RUN #1 (alone) — add the enum value (idempotent, sorts above SUPER_ADMIN) ──
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'OWNER' BEFORE 'SUPER_ADMIN';


-- ── RUN #2 (separately, AFTER run #1 has committed) — promote someone to Owner ─
-- Uncomment and set the email of whoever should be the platform Owner, then run:
-- UPDATE users SET role = 'OWNER' WHERE email = 'info@evertrust-germany.de';
