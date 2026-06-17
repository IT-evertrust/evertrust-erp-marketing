-- CRM additions. hot_leads mirrors the per-campaign hot_leads sheet (21 cols + campaign_id);
-- customers is the central CRM. Both upsert on email. CRM READS leads.status (Glock/
-- ContractMaker vocabulary) + meetings (ContractMaker's table) + customers (dedup).
-- The n8n "provision hot_leads sheet" step is unnecessary here — the table is provisioned once.

-- Mirrors the LIVE hot_leads table exactly. The n8n sheet's Meeting 1-5 columns were
-- collapsed in the DB into a single `final_meeting` + a joined history in `note`; `lead_id` added.
CREATE TABLE IF NOT EXISTS hot_leads (
    id             serial PRIMARY KEY,
    campaign_id    int NOT NULL,
    lead_id        int,
    company_name   text, company_type text, email text NOT NULL,
    website        text, city text, country text, tier text, niche text,
    source_campaign text,
    hot_reason     text,              -- 'Interested' | 'MeetingScheduled'
    meeting_date   text,
    lead_status    text,
    detected_at    timestamptz NOT NULL DEFAULT now(),
    note           text,             -- joined 'date: outcome | ...' meeting history
    final_meeting  text,              -- 'Signed <date>' or ''
    contract_status text,             -- 'Signed' or ''
    UNIQUE (campaign_id, email)
);

-- Mirrors the LIVE customers table exactly (adds owner, notes). The pipeline writes
-- stage/hot_reason/contract_status explicitly rather than relying on column defaults.
CREATE TABLE IF NOT EXISTS customers (
    id              serial PRIMARY KEY,
    company_name    text, company_type text, email text NOT NULL UNIQUE,
    website         text, city text, country text, tier text, niche text,
    source_campaign text,
    stage           text NOT NULL DEFAULT 'Customer',
    hot_reason      text NOT NULL DEFAULT 'Signed',
    meeting_date    text,
    owner           text,
    notes           text,
    cooperation_term text,
    contract_status text NOT NULL DEFAULT 'Signed',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
