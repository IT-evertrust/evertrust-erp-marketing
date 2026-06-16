-- RAG Agent additions to the shared contract. campaigns/leads already exist (Bazooka +
-- the migration). This adds the two tables the RAG agent reads/writes:
--   knowledge_docs   ← Evertrust_Knowledge_Base.txt (full-doc grounding, NOT vector RAG)
--   unsure_analysis  ← the per-campaign Unsure_Analysis sheet output
-- Columns match the live schema EXACTLY (drift caused a prior production break).
--
-- The RAG agent READS: campaigns (id, name, active, sender), leads (status='unsure',
--   email, company_name, country, send_from, campaign_id, id), knowledge_docs.content.
-- It WRITES: unsure_analysis rows (one per drafted lead). It only ever stages Gmail
--   DRAFTS — never sends. Idempotency is on unsure_analysis.thread_dedup_key.

CREATE TABLE IF NOT EXISTS knowledge_docs (
    id         serial PRIMARY KEY,
    name       text UNIQUE NOT NULL,            -- e.g. 'Evertrust_Knowledge_Base'
    content    text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS unsure_analysis (
    id               serial PRIMARY KEY,
    campaign_id      int,
    lead_id          int,
    client_email     text,
    company_name     text,
    unsure_section   text,
    category         text,                      -- the model's unsureArea (closed set)
    draft_subject    text,
    drafted_reply    text,
    scanned_from     text,                      -- which mailbox the thread was scanned from
    thread_dedup_key text,                      -- leadEmail|threadId|lastMessageId (idempotency)
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- idempotency lookup (fixes the DISABLED n8n 'Skip Seen Messages' node)
CREATE INDEX IF NOT EXISTS idx_unsure_analysis_dedup
    ON unsure_analysis (thread_dedup_key);
