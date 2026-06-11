-- Key Account pipeline: add the ONGOING stage (deal in progress) between
-- MEETING_SCHEDULED and CUSTOMER, so the board reads
-- Interested -> Meeting Scheduled -> Ongoing -> Customer. ONGOING is ERP-only
-- (set by hand); n8n never assigns it. ADD VALUE IF NOT EXISTS is idempotent and
-- only ADDS the value (never uses it here), so it is safe inside the migration txn.
ALTER TYPE "public"."lead_stage" ADD VALUE IF NOT EXISTS 'ONGOING' BEFORE 'CUSTOMER';
