-- Reach Bazooka (auto-send) + per-lead-per-round send/tracking events.
-- reach_sends is one row per (lead, round): records the send + open/click/reply
-- timestamps, the source of truth for stats and the daily timeline. auto_send is
-- the Bazooka on/off toggle per campaign. Idempotent.

DO $$ BEGIN
  CREATE TYPE reach_round AS ENUM ('cold','followup','final');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE reach_aims ADD COLUMN IF NOT EXISTS auto_send boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS reach_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  aim_id uuid NOT NULL REFERENCES reach_aims(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES reach_leads(id) ON DELETE CASCADE,
  round reach_round NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS reach_sends_lead_round_uq ON reach_sends (lead_id, round);
CREATE INDEX IF NOT EXISTS reach_sends_aim_id_idx ON reach_sends (aim_id);
CREATE INDEX IF NOT EXISTS reach_sends_organization_id_idx ON reach_sends (organization_id);
