-- Idempotency key for the Engage meeting-loop COUNTER round (schema/engage-replies.ts).
-- The scan re-runs reply_glock for every lead whose counter-proposal is still the latest
-- inbound message; without this marker the COUNTER branch would re-fetch calendar
-- alternatives, overwrite proposed_slots and re-run the (expensive) draft regeneration on
-- every scan, clobbering any manual draft edits the operator made between scans. This
-- column records the Gmail message id of the inbound counter we last resolved into a
-- COUNTER round, so the scan can skip re-resolving/re-drafting while it is unchanged.
-- Additive + idempotent so a boot-time re-run (api-start.sh) is safe.
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "counter_resolved_inbound_id" text;
