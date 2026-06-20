-- Reach (Growth Engine) lean tables: reach_aims (campaign + config.json +
-- generated templates/news) and reach_leads (Lead Satellite output).
-- Idempotent + applied directly because the local Drizzle journal is behind the
-- live Supabase DB (divergence); this file is the record of what was applied.

DO $$ BEGIN
  CREATE TYPE reach_aim_status AS ENUM ('DRAFT','READY','RUNNING','COMPLETED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE reach_lead_status AS ENUM ('NEW','COLD_OUTREACHED','FOLLOWED_UP','INTERESTED','UNSURE','NOT_INTERESTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS reach_aims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  niche text NOT NULL,
  region text NOT NULL,
  segment text,
  source text,
  status reach_aim_status NOT NULL DEFAULT 'DRAFT',
  templates jsonb,
  news_brief jsonb,
  generated_by text,
  companies integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reach_aims_organization_id_idx ON reach_aims (organization_id);

CREATE TABLE IF NOT EXISTS reach_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  aim_id uuid NOT NULL REFERENCES reach_aims(id) ON DELETE CASCADE,
  company text NOT NULL,
  website text,
  contact_name text,
  contact_title text,
  email text,
  phone text,
  location text,
  source text,
  qualification_reason text,
  confidence double precision,
  status reach_lead_status NOT NULL DEFAULT 'NEW',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reach_leads_aim_id_idx ON reach_leads (aim_id);
CREATE INDEX IF NOT EXISTS reach_leads_organization_id_idx ON reach_leads (organization_id);
