ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "proposed_slots" jsonb;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "meeting_status" text NOT NULL DEFAULT 'NONE';--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "accepted_slot" jsonb;--> statement-breakpoint
ALTER TABLE "reach_lead_replies" ADD COLUMN IF NOT EXISTS "booked_meeting_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_lead_replies" ADD CONSTRAINT "reach_lead_replies_booked_meeting_id_meetings_id_fk" FOREIGN KEY ("booked_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
