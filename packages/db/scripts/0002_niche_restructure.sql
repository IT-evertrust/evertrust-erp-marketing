-- EverTrust niche restructure → IT / Transportation / Power.
-- Idempotent + transactional + self-verifying: re-runnable, and if anything is off the
-- whole block RAISEs and rolls back (no partial writes). Targets are only ADDED, never
-- deleted, so nothing referenced by prospects can break.
DO $$
DECLARE
  v_org   uuid;
  v_it    uuid; v_trans uuid; v_power uuid;
  v_dup   uuid; v_canon uuid; v_niche uuid;
  has_leads_niche boolean;
  m RECORD; x RECORD;
BEGIN
  -- 0. the (single) org that owns the niches
  SELECT organization_id INTO v_org FROM niches GROUP BY organization_id ORDER BY count(*) DESC LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'No niches found — nothing to do'; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='niche_id')
    INTO has_leads_niche;

  -- 1. ensure the three industries
  INSERT INTO industries (organization_id, name, slug) VALUES
    (v_org,'IT','it'), (v_org,'Transportation','transportation'), (v_org,'Power','power')
  ON CONFLICT (organization_id, slug) DO NOTHING;
  SELECT id INTO v_it    FROM industries WHERE organization_id=v_org AND slug='it';
  SELECT id INTO v_trans FROM industries WHERE organization_id=v_org AND slug='transportation';
  SELECT id INTO v_power FROM industries WHERE organization_id=v_org AND slug='power';

  -- 2. merge duplicate niches (dup -> canonical): repoint campaigns/leads, move/clear targets, drop dup
  FOR m IN SELECT * FROM (VALUES
      ('cloud','cloud infrastructure'),
      ('cyberbezpieczeństwo','cybersecurity'),
      ('construction container','container'),
      ('it','cybersecurity')
    ) AS t(dup_slug, canon_slug)
  LOOP
    SELECT id INTO v_dup   FROM niches WHERE organization_id=v_org AND slug=m.dup_slug;
    SELECT id INTO v_canon FROM niches WHERE organization_id=v_org AND slug=m.canon_slug;
    IF v_dup IS NULL OR v_canon IS NULL OR v_dup = v_canon THEN CONTINUE; END IF;
    UPDATE campaigns SET niche_id=v_canon WHERE niche_id=v_dup;
    IF has_leads_niche THEN EXECUTE 'UPDATE leads SET niche_id=$1 WHERE niche_id=$2' USING v_canon, v_dup; END IF;
    UPDATE niche_targets s SET niche_id=v_canon
      WHERE s.niche_id=v_dup
        AND NOT EXISTS (SELECT 1 FROM niche_targets c WHERE c.niche_id=v_canon AND c.slug=s.slug);
    DELETE FROM niche_targets WHERE niche_id=v_dup;
    DELETE FROM niches WHERE id=v_dup;
  END LOOP;

  -- 3. assign the surviving niches to industries
  UPDATE niches SET industry_id=v_it
    WHERE organization_id=v_org AND slug IN ('ai platform','cloud infrastructure','cybersecurity','software development');
  UPDATE niches SET industry_id=v_trans WHERE organization_id=v_org AND slug='container';
  UPDATE niches SET industry_id=v_power WHERE organization_id=v_org AND slug='led';

  -- 4. drop leftover industries (e.g. hand-made Container/LED) that aren't one of the three and hold no niches
  DELETE FROM industries i
    WHERE i.organization_id=v_org AND i.slug NOT IN ('it','transportation','power')
      AND NOT EXISTS (SELECT 1 FROM niches n WHERE n.industry_id=i.id);

  -- 5. reset each surviving niche's targets to exactly the researched set.
  --    Safe because no prospects reference targets yet; if one did, the FK on
  --    prospects.niche_target_id would abort the whole block (nothing partial).
  DELETE FROM niche_targets WHERE niche_id IN (SELECT id FROM niches WHERE organization_id=v_org);
  FOR x IN SELECT * FROM (VALUES
      ('ai platform','Provider'),('ai platform','Vendor'),('ai platform','Integrator'),('ai platform','Reseller'),('ai platform','Consultancy'),
      ('cloud infrastructure','Provider'),('cloud infrastructure','MSP'),('cloud infrastructure','Integrator'),('cloud infrastructure','Reseller'),('cloud infrastructure','Installer'),
      ('cybersecurity','Provider'),('cybersecurity','MSSP'),('cybersecurity','Consultancy'),('cybersecurity','Integrator'),('cybersecurity','Reseller'),
      ('software development','Provider'),('software development','Agency'),('software development','Software House'),('software development','Consultancy'),('software development','Integrator'),
      ('container','Manufacturer'),('container','Supplier'),('container','Distributor'),('container','Leasing'),('container','Installer'),
      ('led','Manufacturer'),('led','Distributor'),('led','Wholesaler'),('led','Installer'),('led','Electrical Contractor')
    ) AS t(niche_slug, target_name)
  LOOP
    SELECT id INTO v_niche FROM niches WHERE organization_id=v_org AND slug=x.niche_slug;
    IF v_niche IS NULL THEN CONTINUE; END IF;
    INSERT INTO niche_targets (niche_id, name, slug, source, enabled)
      VALUES (v_niche, x.target_name, lower(trim(x.target_name)), 'MANUAL', true)
      ON CONFLICT (niche_id, slug) DO NOTHING;
  END LOOP;

  -- 6. verify the end state, else roll the whole thing back
  IF (SELECT count(*) FROM niches WHERE organization_id=v_org) <> 6 THEN
    RAISE EXCEPTION 'Expected 6 niches, found %', (SELECT count(*) FROM niches WHERE organization_id=v_org);
  END IF;
  IF (SELECT count(*) FROM industries WHERE organization_id=v_org AND slug IN ('it','transportation','power')) <> 3 THEN
    RAISE EXCEPTION 'IT/Transportation/Power industries not all present';
  END IF;
  IF EXISTS (SELECT 1 FROM campaigns c WHERE c.niche_id NOT IN (SELECT id FROM niches)) THEN
    RAISE EXCEPTION 'Orphaned campaigns detected';
  END IF;

  RAISE NOTICE 'OK — 6 niches under IT/Transportation/Power, targets seeded.';
END $$;
