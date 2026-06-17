-- ContractMaker additions. The `meetings` table is the meeting log (was the "CM Meeting
-- Log" Google Sheet) — ContractMaker WRITES it and CRM Customer READS it (the seam).
-- `contracts` records each generated contract (idempotency lock per company).

CREATE TABLE IF NOT EXISTS meetings (
    id              serial PRIMARY KEY,
    company_key     text NOT NULL,       -- normalized company name (CRM matches on this)
    company_name    text,
    country         text,
    niche           text,
    meeting_id      text,
    meeting_date    date,
    title           text,
    transcript      text,
    sign_now        boolean NOT NULL DEFAULT false,
    meeting_outcome text,
    cooperation_term text,
    processed       boolean NOT NULL DEFAULT false,   -- contract generated for this company
    logged_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meetings_company_key_idx ON meetings (company_key);

CREATE TABLE IF NOT EXISTS contracts (
    id            serial PRIMARY KEY,
    company_key   text NOT NULL,
    company_name  text,
    campaign_id   int,
    template_name text,
    pdf_ref       text,                  -- Drive file id or path once generated
    fields        jsonb,
    generated_at  timestamptz NOT NULL DEFAULT now()
);
