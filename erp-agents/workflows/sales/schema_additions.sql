-- Sales Agent additions. Ports the n8n 'AI Personas' Drive folder -> `personas` and the
-- "Meeting Analyses" Google Sheet -> `meeting_analyses` (the CLEAN column set from
-- Merge Doc Link / §6.10; the sheet's legacy duplicate columns are intentionally ignored).
-- error_log already exists (owned by bazooka); included here only as a reference of the
-- columns this agent writes (workflow, campaign, lead_email, step, reason).

CREATE TABLE IF NOT EXISTS personas (
    id          serial PRIMARY KEY,
    name        text NOT NULL UNIQUE,      -- e.g. "Alex Hormozi"
    prompt      text,                      -- the persona body text (system-message preamble)
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_analyses (
    id                          serial PRIMARY KEY,
    client_name                 text,
    ae_name                     text,
    meeting_date                date,
    summary                     text,
    strengths                   text,
    weaknesses                  text,
    performance_score           int,
    understanding_client_needs  int,
    communication               int,
    technical_explanation       int,
    aggressiveness              int,
    client_score                int,
    client_buying_intent        int,
    client_interest             int,
    client_communication        int,
    persona                     text,
    transcript                  text,
    report_html                 text,
    doc_link                    text,
    source                      text,
    generated_at                timestamptz NOT NULL DEFAULT now()
);

-- error_log already exists (created by bazooka). Reference shape (workflow column required
-- by the sales port):
-- CREATE TABLE IF NOT EXISTS error_log (
--     id          serial PRIMARY KEY,
--     ts          timestamptz NOT NULL DEFAULT now(),
--     workflow    text,
--     campaign    text,
--     lead_email  text,
--     step        text,
--     reason      text
-- );
