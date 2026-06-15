-- ============================================================================
-- EverTrust — FRESH START  (DESTRUCTIVE — wipes business data).
-- Run in the Supabase SQL Editor.
--
-- Empties every table in schema `public` EXCEPT the keep-list:
--     login   → users · auth_credentials · organizations
--     niches  → industries · niches · niche_targets
-- so you stay signed in AND your niche structure survives. Everything else
-- (tenders, customers, suppliers, campaigns, prospects, leads, contracts,
-- outreach, workflow_config, audit_log, …) is truncated.
--
-- Dynamic on purpose: it discovers tables at runtime, so it cannot break on
-- schema drift and automatically covers any table not in the keep-list.
-- Runs as ONE atomic statement — if anything fails, the whole thing rolls
-- back (no partial wipe). Sequences are reset; FK ordering is handled by
-- CASCADE. None of the kept tables reference anything that gets truncated
-- (industries→organizations, niches→organizations/industries,
-- niche_targets→niches — all kept), so CASCADE never reaches them. Touches
-- `public` only — Supabase-managed schemas (auth, storage, realtime, …) are
-- left alone.
-- ============================================================================

-- ── 1. PREVIEW (read-only) — run this first to see what will be wiped + counts ──
-- SELECT tablename,
--        (xpath('/row/c/text()',
--               query_to_xml(format('SELECT count(*) c FROM %I.%I', schemaname, tablename),
--                            false, true, '')))[1]::text::bigint AS rows
--   FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename NOT IN ('users', 'auth_credentials', 'organizations',
--                          'industries', 'niches', 'niche_targets')
--  ORDER BY rows DESC, tablename;

-- ── 2. THE WIPE ──
DO $$
DECLARE
  v_keep   text[] := ARRAY[
    'users', 'auth_credentials', 'organizations',  -- login
    'industries', 'niches', 'niche_targets'        -- niche structure
  ];
  v_tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO v_tables
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename <> ALL (v_keep);

  IF v_tables IS NULL THEN
    RAISE NOTICE 'Nothing to truncate.';
  ELSE
    EXECUTE 'TRUNCATE TABLE ' || v_tables || ' RESTART IDENTITY CASCADE';
    RAISE NOTICE 'Fresh start done. Kept: %.', array_to_string(v_keep, ', ');
    RAISE NOTICE 'Truncated: %', v_tables;
  END IF;
END $$;
