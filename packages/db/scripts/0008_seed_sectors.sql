-- 0008_seed_sectors.sql
-- Seed the Evertrust org's "Sectors": industries → niches → the target archetypes
-- the Lead Scraper (Lead Satellite) hunts per niche. Scoped to the `evertrust` org
-- by slug. Idempotent — re-runnable: ON CONFLICT DO NOTHING against the
-- (organization_id, slug) / (niche_id, slug) unique indexes.
--
-- Slugs match @evertrust/shared slugify(): lowercase, whitespace -> '-' (so the API
-- find-or-create dedups against these rows; note "Transportation & Construction"
-- keeps its ampersand, exactly as slugify produces).
--
-- Apply to Supabase the same way as the other catch-up scripts (psql "$DATABASE_URL" -f).

DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organizations WHERE slug = 'evertrust' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'evertrust org not found — skipping sector seed.';
    RETURN;
  END IF;

  -- Industries.
  INSERT INTO industries (organization_id, name, slug)
  VALUES
    (v_org, 'IT', 'it'),
    (v_org, 'Power', 'power'),
    (v_org, 'Transportation & Construction', 'transportation-&-construction')
  ON CONFLICT (organization_id, slug) DO NOTHING;

  -- Niches (each linked to its industry).
  INSERT INTO niches (organization_id, name, slug, industry_id)
  SELECT v_org, v.name, v.slug, i.id
  FROM (VALUES
    ('Cloud Infrastructure', 'cloud-infrastructure', 'it'),
    ('Software Development', 'software-development', 'it'),
    ('AI Platform', 'ai-platform', 'it'),
    ('Cybersecurity', 'cybersecurity', 'it'),
    ('LED', 'led', 'power'),
    ('Container', 'container', 'transportation-&-construction')
  ) AS v(name, slug, industry_slug)
  JOIN industries i ON i.organization_id = v_org AND i.slug = v.industry_slug
  ON CONFLICT (organization_id, slug) DO NOTHING;

  -- Targets (the archetypes Lead Satellite hunts for each niche).
  INSERT INTO niche_targets (niche_id, name, slug, source, enabled)
  SELECT n.id, v.name, v.slug, 'MANUAL'::niche_target_source, true
  FROM (VALUES
    -- IT · Cloud Infrastructure
    ('cloud-infrastructure', 'Cloud Provider', 'cloud-provider'),
    ('cloud-infrastructure', 'Managed Service Provider', 'managed-service-provider'),
    ('cloud-infrastructure', 'System Integrator', 'system-integrator'),
    ('cloud-infrastructure', 'Data Center Operator', 'data-center-operator'),
    ('cloud-infrastructure', 'Hosting Provider', 'hosting-provider'),
    ('cloud-infrastructure', 'Cloud Reseller', 'cloud-reseller'),
    -- IT · Software Development
    ('software-development', 'Software Agency', 'software-agency'),
    ('software-development', 'SaaS Vendor', 'saas-vendor'),
    ('software-development', 'IT Consultancy', 'it-consultancy'),
    ('software-development', 'System Integrator', 'system-integrator'),
    ('software-development', 'DevOps Vendor', 'devops-vendor'),
    ('software-development', 'Custom Software Shop', 'custom-software-shop'),
    -- IT · AI Platform
    ('ai-platform', 'AI Platform Vendor', 'ai-platform-vendor'),
    ('ai-platform', 'MLOps Provider', 'mlops-provider'),
    ('ai-platform', 'Data Analytics Platform', 'data-analytics-platform'),
    ('ai-platform', 'AI Consultancy', 'ai-consultancy'),
    ('ai-platform', 'AI SaaS Startup', 'ai-saas-startup'),
    ('ai-platform', 'AI System Integrator', 'ai-system-integrator'),
    -- IT · Cybersecurity
    ('cybersecurity', 'Managed Security Provider', 'managed-security-provider'),
    ('cybersecurity', 'Security Consultancy', 'security-consultancy'),
    ('cybersecurity', 'SOC Provider', 'soc-provider'),
    ('cybersecurity', 'Penetration Testing Firm', 'penetration-testing-firm'),
    ('cybersecurity', 'Security Software Vendor', 'security-software-vendor'),
    ('cybersecurity', 'Compliance Auditor', 'compliance-auditor'),
    -- Power · LED
    ('led', 'LED Manufacturer', 'led-manufacturer'),
    ('led', 'Lighting Distributor', 'lighting-distributor'),
    ('led', 'LED Installer', 'led-installer'),
    ('led', 'Electrical Contractor', 'electrical-contractor'),
    ('led', 'Lighting Designer', 'lighting-designer'),
    ('led', 'Retrofit Specialist', 'retrofit-specialist'),
    -- Transportation & Construction · Container
    ('container', 'Container Manufacturer', 'container-manufacturer'),
    ('container', 'Container Dealer', 'container-dealer'),
    ('container', 'Container Modification Firm', 'container-modification-firm'),
    ('container', 'Container Leasing Provider', 'container-leasing-provider'),
    ('container', 'Modular Building Provider', 'modular-building-provider'),
    ('container', 'Freight Forwarder', 'freight-forwarder')
  ) AS v(niche_slug, name, slug)
  JOIN niches n ON n.organization_id = v_org AND n.slug = v.niche_slug
  ON CONFLICT (niche_id, slug) DO NOTHING;

  RAISE NOTICE 'Sector seed applied for evertrust org %.', v_org;
END $$;
