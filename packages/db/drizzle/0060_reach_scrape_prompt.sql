-- Reach "Generate Prompt": store the lead-scraping prompt authored by the local
-- model (reach.prompt_forge) from an aim's config. Reach now PRODUCES this prompt —
-- to be pasted into OpenAI to run the scrape — instead of running the local-model
-- Lead Satellite scrape itself. Additive + idempotent (safe on a boot-time re-run
-- and on a push-managed DB).
ALTER TABLE "reach_aims" ADD COLUMN IF NOT EXISTS "scrape_prompt" text;
