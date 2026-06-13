-- 0001_niche_cleanup.sql
-- ONE-TIME, APPROVED niche data cleanup for the EverTrust `evertrust` (prod) database.
--
-- This is a DATA-ONLY change. It does NOT touch the schema, migrations, or the
-- niche_targets structure. The `industries` table and `niches.industry_id` FK
-- already exist (migration 0023). This script only moves/relabels data.
--
-- What it does (all niches are single-tenant — one org owns every niche):
--   1. Creates 3 industries (IT, Construction, Lighting) per owning org, idempotently.
--   2. Merges 4 duplicate niches into their canonical niche:
--        cloud                  -> cloud infrastructure
--        cyberbezpieczenstwo    -> cybersecurity        (Polish "cyberbezpieczeństwo")
--        construction container -> container
--        it                     -> cybersecurity        ('IT' lives on only as an industry)
--      For each merge it repoints campaigns.niche_id and leads.niche_id, moves the
--      dup's non-conflicting niche_targets onto the canonical (conflicting slugs are
--      dropped to respect the (niche_id, slug) unique index), then deletes the empty dup.
--   3. Assigns industries to the 6 surviving niches via niches.industry_id.
--   4. Light target tidy inside cybersecurity: drop the 'Prodiver' typo row (a
--      'provider' target already exists) and dedupe 'solution'/'Solutions' to a
--      single 'solution' row.
--
-- Idempotent: re-running is a no-op. Merges key off the dup slug (gone after the
-- first run), industry inserts use ON CONFLICT DO NOTHING, assignments are plain
-- UPDATE ... WHERE slug IN (...), and the target tidy is guarded by existence checks.
--
-- Transactional: the caller wraps this in a single transaction (BEGIN; \i ...;
-- run the verification queries; COMMIT only if every check passes, else ROLLBACK).

-- ---------------------------------------------------------------------------
-- 1. Create the 3 industries (idempotent) in every org that owns these niches.
--    Single-tenant today, but scoped by org so it stays correct if that changes.
-- ---------------------------------------------------------------------------
INSERT INTO industries (organization_id, name, slug)
SELECT DISTINCT n.organization_id, v.name, v.slug
FROM niches n
CROSS JOIN (VALUES
  ('IT', 'it'),
  ('Construction', 'construction'),
  ('Lighting', 'lighting')
) AS v(name, slug)
WHERE n.slug IN (
  'cloud infrastructure', 'ai platform', 'cybersecurity',
  'software development', 'container', 'led',
  'cloud', 'cyberbezpieczeństwo', 'construction container', 'it'
)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Merge duplicate niches. One DO block per (dup -> canonical) pair, matched
--    within the same org. Each block is a no-op once the dup row is gone.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m RECORD;
  dup_id  uuid;
  can_id  uuid;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('cloud',                  'cloud infrastructure'),
      ('cyberbezpieczeństwo',    'cybersecurity'),
      ('construction container', 'container'),
      ('it',                     'cybersecurity')
    ) AS t(dup_slug, canonical_slug)
  LOOP
    FOR dup_id, can_id IN
      SELECT d.id, c.id
      FROM niches d
      JOIN niches c
        ON c.organization_id = d.organization_id
       AND c.slug = m.canonical_slug
      WHERE d.slug = m.dup_slug
    LOOP
      -- Repoint campaigns from the dup to the canonical niche.
      UPDATE campaigns SET niche_id = can_id WHERE niche_id = dup_id;

      -- Repoint leads from the dup to the canonical niche (leads.niche_id exists).
      UPDATE leads SET niche_id = can_id WHERE niche_id = dup_id;

      -- Move the dup's targets whose slug does NOT already exist on the canonical.
      UPDATE niche_targets t
         SET niche_id = can_id
       WHERE t.niche_id = dup_id
         AND NOT EXISTS (
           SELECT 1 FROM niche_targets e
            WHERE e.niche_id = can_id AND e.slug = t.slug
         );

      -- Delete the dup's now-conflicting leftover targets (slug already on canonical).
      DELETE FROM niche_targets t WHERE t.niche_id = dup_id;

      -- Delete the now-empty duplicate niche.
      DELETE FROM niches WHERE id = dup_id;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Assign industries to the surviving niches (idempotent UPDATEs, org-scoped
--    via the industry FK lookup).
-- ---------------------------------------------------------------------------
-- IT industry -> cloud infrastructure, ai platform, cybersecurity, software development
UPDATE niches n
   SET industry_id = i.id
  FROM industries i
 WHERE i.organization_id = n.organization_id
   AND i.slug = 'it'
   AND n.slug IN ('cloud infrastructure', 'ai platform', 'cybersecurity', 'software development');

-- Construction industry -> container
UPDATE niches n
   SET industry_id = i.id
  FROM industries i
 WHERE i.organization_id = n.organization_id
   AND i.slug = 'construction'
   AND n.slug = 'container';

-- Lighting industry -> led
UPDATE niches n
   SET industry_id = i.id
  FROM industries i
 WHERE i.organization_id = n.organization_id
   AND i.slug = 'lighting'
   AND n.slug = 'led';

-- ---------------------------------------------------------------------------
-- 4. Light target tidy inside cybersecurity (guarded; safe to re-run).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cyber_id uuid;
BEGIN
  SELECT id INTO cyber_id FROM niches WHERE slug = 'cybersecurity' LIMIT 1;
  IF cyber_id IS NULL THEN
    RETURN;
  END IF;

  -- 4a. 'Prodiver' typo (slug 'prodiver'): a 'provider' target already exists,
  --     so DELETE the prodiver row rather than renaming (would collide).
  IF EXISTS (SELECT 1 FROM niche_targets WHERE niche_id = cyber_id AND slug = 'provider') THEN
    DELETE FROM niche_targets WHERE niche_id = cyber_id AND slug = 'prodiver';
  ELSE
    -- No 'provider' present (shouldn't happen here) — fix the typo in place.
    UPDATE niche_targets SET name = 'Provider', slug = 'provider'
     WHERE niche_id = cyber_id AND slug = 'prodiver';
  END IF;

  -- 4b. Dedupe 'solution'/'Solutions' to a single row with slug 'solution'.
  --     A 'solution' row already exists, so drop the 'solutions' row.
  IF EXISTS (SELECT 1 FROM niche_targets WHERE niche_id = cyber_id AND slug = 'solution') THEN
    DELETE FROM niche_targets WHERE niche_id = cyber_id AND slug = 'solutions';
  ELSE
    -- Only 'solutions' present — normalise it to the canonical 'solution'.
    UPDATE niche_targets SET name = 'Solution', slug = 'solution'
     WHERE niche_id = cyber_id AND slug = 'solutions';
  END IF;
END $$;
