-- Reply Glock additions to the shared contract (bazooka/schema.sql + satellite's).
-- Glock READS: leads (status, notes, thread_id, sender, company_name, company_type),
--              outreach_threads (email, thread_id) — both written by Bazooka.
-- Glock WRITES: leads.status (the shared vocabulary), pending_slots, processed_replies.
--
-- Status vocabulary Glock assigns (verbatim, shared with Bazooka's compute_action which
-- treats all of them as terminal/skip): Interested | Unsure | Meeting Scheduled |
-- Not Interested - Do Not Contact | Not Interested - Snoozed<YYYY-MM-DD>.

-- dedup: which Gmail replies we've already handled (replaces staticData._processedReplyIds)
CREATE TABLE IF NOT EXISTS processed_replies (
    message_id   text PRIMARY KEY,
    thread_id    text,
    lead_email   text,
    classification text,
    processed_at timestamptz NOT NULL DEFAULT now()
);

-- the two slots proposed to an Interested lead (replaces the ::SLOTS:: Notes marker)
CREATE TABLE IF NOT EXISTS pending_slots (
    lead_email   text PRIMARY KEY,
    campaign_id  int,
    slot1        jsonb,        -- {start, end, human}
    slot2        jsonb,
    proposed_at  timestamptz NOT NULL DEFAULT now()
);
