-- Per-org Python-agent LLM gateway (AI Engine → erp-agents). Adds two NULLABLE
-- org_config columns so an admin can point the agents (lead satellite, etc.) at a
-- per-org gateway + model from the AI Engine card. agent_llm_base_url is the
-- OpenAI-compatible gateway base URL (null = env LLM_BASE_URL default);
-- agent_llm_model is the model id, e.g. 'hermes' (null = env EXTRACT_MODEL default).
-- The agent API key is NEVER stored per-org — it resolves from env LLM_API_KEY and
-- travels ERP→agent only. Additive + idempotent so a boot-time re-run is safe.
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "agent_llm_base_url" text;
--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN IF NOT EXISTS "agent_llm_model" text;
