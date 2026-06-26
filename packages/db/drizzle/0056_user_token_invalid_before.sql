-- Forced-logout watermark for users. When an admin removes a user's connected
-- Google account from Settings, we stamp users.token_invalid_before = now(); any
-- session JWT issued (iat) before that instant is then rejected by JwtStrategy, so
-- the user must sign in again — while a fresh login still works (newer iat).
-- Additive + idempotent (safe on a boot-time re-run and on a push-managed DB).
-- Hand-authored because the repo's drizzle meta/ snapshot chain is incomplete
-- (0005+ snapshots were never committed), which blocks drizzle-kit generate; the
-- migrator applies this from the journal + SQL directly.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_invalid_before" timestamp with time zone;
