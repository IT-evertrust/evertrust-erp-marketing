-- Meeting-loop columns on reach_lead_replies (propose → accept/counter → book).
--
-- NOTE: reach_lead_replies (and the rest of the Reach/Engage stack) is currently
-- managed via drizzle-kit `push`, not migrations — no CREATE migration exists for
-- the table. So this ALTER is GUARDED: on a clean `migrate` target where the table
-- doesn't exist yet (the jest Testcontainer / a fresh prod), the whole block no-ops
-- instead of aborting the migration run; on the push-managed local/prod DB where the
-- table exists, the columns are added idempotently. (Tracked: the reach/engage stack
-- needs proper CREATE migrations — migration-chain repair backlog item.)
DO $$
BEGIN
  IF to_regclass('public.reach_lead_replies') IS NULL THEN RETURN; END IF;
  ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "proposed_slots" jsonb;
  ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "meeting_status" text NOT NULL DEFAULT 'NONE';
  ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "accepted_slot" jsonb;
  ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "booked_meeting_id" uuid;
  BEGIN
    ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_booked_meeting_id_meetings_id_fk"
      FOREIGN KEY ("booked_meeting_id") REFERENCES "public"."meetings"("id");
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
