-- Migration-chain repair for reach_aims.persona_id (schema/reach.ts).
--
-- persona_id was added to the Drizzle schema and applied to local/prod via
-- drizzle-kit `push`, but never captured as a migration: 0037 created reach_aims
-- (auto_send + companies already included) and 0040 added campaign_id, yet nothing
-- ever added persona_id. So a clean `migrate` target (the jest Testcontainer / a
-- fresh prod) lacks the column, and any `select().from(reach_aims)` — e.g.
-- EngageRepliesService.resolveCampaign — dies with
-- `column "persona_id" of relation "reach_aims" does not exist`.
-- This append-only migration backfills the gap. persona_id is the OPTIONAL Engage
-- drafting persona (NULL = the default EVERTRUST voice) and FKs personas.id, which
-- 0015 created. Additive + idempotent (DO $$ ... duplicate_object FK guard) so a
-- boot-time re-run (api-start.sh) and a push-managed DB where the column/constraint
-- already exist are both safe.
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "persona_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach_aims" ADD CONSTRAINT "reach_aims_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
