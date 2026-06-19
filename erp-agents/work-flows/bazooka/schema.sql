-- REACH BAZOOKA data contract (see REACH_BAZOOKA_PYTHON_PLAN.md section 3).
-- Read side (campaigns/leads/templates/news_intel) is owned by the campaign-feeding
-- system; write side (send_log/outreach_threads/error_log/runs) is owned by the pipeline.

CREATE TABLE IF NOT EXISTS campaigns (
    id                 serial PRIMARY KEY,
    name               text NOT NULL UNIQUE,
    active             boolean NOT NULL DEFAULT true,
    niche              text,
    target             text,
    country            text,
    region             text,
    project            text,
    sender             text NOT NULL DEFAULT 'info',   -- 'info' | 'hanna' (Gmail routing)
    gmail_label        text,
    sales_calendar_id  text
);

CREATE TABLE IF NOT EXISTS leads (
    id            serial PRIMARY KEY,
    campaign_id   int NOT NULL REFERENCES campaigns(id),
    company_name  text NOT NULL DEFAULT '',
    company_type  text NOT NULL DEFAULT '',
    email         text NOT NULL DEFAULT '',
    status        text NOT NULL DEFAULT '',  -- '' | 'Cold Outreached' | 'Followed Up' | 'Final Push'
                                             -- (Reply Glock adds its own statuses later)
    date_sent     date,
    thread_id     text,                      -- replaces the '::TID::<id>::' Notes hack
    notes         text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS templates (
    campaign_id  int NOT NULL REFERENCES campaigns(id),
    block        text NOT NULL CHECK (block IN ('COLD', 'COLD-AGG', 'FOLLOWUP', 'FINALPUSH')),
    subject      text NOT NULL,
    body         text NOT NULL,              -- {{Company Name}} etc. placeholders intact
    UNIQUE (campaign_id, block)
);

CREATE TABLE IF NOT EXISTS news_intel (
    id           serial PRIMARY KEY,
    campaign_id  int NOT NULL REFERENCES campaigns(id),
    body         text NOT NULL,
    is_bad_news  boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---- pipeline-owned write side ------------------------------------------------

CREATE TABLE IF NOT EXISTS send_log (
    id                serial PRIMARY KEY,
    lead_id           int NOT NULL,
    campaign_id       int NOT NULL,
    action_type       text NOT NULL,         -- 'cold' | 'followup' | 'finalpush'
    sent_on           date NOT NULL,
    gmail_message_id  text,
    gmail_thread_id   text,
    UNIQUE (lead_id, action_type, sent_on)   -- the idempotency guard
);

CREATE TABLE IF NOT EXISTS outreach_threads (
    email       text NOT NULL,
    thread_id   text NOT NULL,
    message_id  text,
    kind        text NOT NULL DEFAULT 'outreach',
    sent_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email, thread_id)
);

CREATE TABLE IF NOT EXISTS error_log (
    id          serial PRIMARY KEY,
    ts          timestamptz NOT NULL DEFAULT now(),
    campaign    text,
    lead_email  text,
    step        text,
    reason      text
);

CREATE TABLE IF NOT EXISTS runs (
    run_id       text PRIMARY KEY,
    started_at   timestamptz NOT NULL,
    finished_at  timestamptz,
    mode         text NOT NULL,              -- 'dry' | 'live'
    counts       jsonb
);
