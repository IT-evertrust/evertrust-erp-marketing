-- Sleeper Grenade additions. Reads leads.status (the Reply Glock vocabulary), and:
--   * due snoozes  -> re-activates the lead (status back to '') so Bazooka re-engages it
--   * do-not-contact -> archives the lead, then removes it from the active pipeline
-- The archive is the copy-before-delete the n8n version CLAIMED but never did.

CREATE TABLE IF NOT EXISTS suppressed_leads (
    id            serial PRIMARY KEY,
    lead_id       int,
    campaign_id   int,
    company_name  text,
    email         text,
    last_status   text,
    reason        text,           -- 'do-not-contact'
    archived_at   timestamptz NOT NULL DEFAULT now(),
    payload       jsonb           -- full lead row snapshot
);

CREATE TABLE IF NOT EXISTS sweep_log (
    id          serial PRIMARY KEY,
    run_id      text,
    lead_id     int,
    email       text,
    action      text,             -- 'reengage' | 'delete'
    detail      text,
    swept_at    timestamptz NOT NULL DEFAULT now()
);
