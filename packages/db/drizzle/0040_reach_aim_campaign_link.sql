-- Reach→Nurture bridge: link a Reach aim to its CRM campaign so a promoted
-- reach_lead can become a prospect on the Nurture board. NULLABLE — an aim only
-- gets a campaign the first time one of its leads is promoted (find-or-created
-- 1:1 from the aim). Idempotent: ADD COLUMN IF NOT EXISTS, the FK constraint is
-- guarded by a duplicate_object catch, and the index uses IF NOT EXISTS.

ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "campaign_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_aims" ADD CONSTRAINT "reach_aims_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reach_aims_campaign_id_idx" ON "reach_aims" ("campaign_id");
