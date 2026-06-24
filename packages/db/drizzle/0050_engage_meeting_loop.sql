-- Engage meeting-loop state on reach_lead_replies (propose → accept/counter → book):
--   proposed_slots             the slots offered the client (PROPOSED / COUNTER rounds)
--   meeting_status             NONE | PROPOSED | ACCEPTED | COUNTER | BOOKED
--   counter_resolved_inbound_id  the inbound id whose counter we last resolved (idempotency)
--   accepted_slot              the agreed {start,end} when ACCEPTED
--   booked_meeting_id          the Activate meeting created when BOOKED (FK + idempotency)
-- Additive + idempotent (safe on a boot-time re-run and on a push-managed DB).
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "proposed_slots" jsonb;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "meeting_status" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "counter_resolved_inbound_id" text;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "accepted_slot" jsonb;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "booked_meeting_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_booked_meeting_id_meetings_id_fk" FOREIGN KEY ("booked_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
