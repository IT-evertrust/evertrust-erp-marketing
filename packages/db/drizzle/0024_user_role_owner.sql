-- Adds the platform OWNER role to the user_role enum. OWNER is the only role
-- whose authority crosses the org boundary — and ONLY over the Users admin
-- surface (list/edit/reset/delete users in any org); all other data stays
-- tenant-scoped. Placed BEFORE 'SUPER_ADMIN' so the enum's sort order reflects
-- the authority tier (OWNER > SUPER_ADMIN > ADMIN > MANAGER > EMPLOYEE).
-- ADD VALUE IF NOT EXISTS is idempotent and safe to re-run.
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'OWNER' BEFORE 'SUPER_ADMIN';
