-- Link each Reach aim to a Growth-Engine campaign (1:1) so its scraped leads can flow
-- into the shared prospects/Nurture pipeline. Additive + idempotent.
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "campaign_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reach_aims" ADD CONSTRAINT "reach_aims_campaign_id_campaigns_id_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reach_aims_campaign_id_idx" ON "reach_aims" USING btree ("campaign_id");
