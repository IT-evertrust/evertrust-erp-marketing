# BAZOOKA — Python port of EVERTRUST — REACH BAZOOKA

Outbound cold-email pipeline, ported from n8n workflow `qVvT6WLTYxtfubUg`
(blueprint + data contract: `../REACH_BAZOOKA_PYTHON_PLAN.md`). Reads/writes Postgres
instead of Drive/Sheets. **Dry-run is the default — nothing sends without `--live`.**

## Isolated test (no Google, no WhatsApp, no LLM needed)

```bash
# 1. a throwaway Postgres (or point DATABASE_URL at any empty database)
docker run -d --name bazooka-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bazooka -p 5432:5432 postgres:16

# 2. install + configure
cd bazooka
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # default DATABASE_URL matches the docker line above

# 3. schema + demo campaign (7 leads covering every decision branch)
python seed_demo.py

# 4. unit tests, then a dry run with deterministic template filling
pytest
python -m bazooka --no-llm
```

The dry run prints the manager WhatsApp messages to stdout and writes the full fire plan
— every lead's decision and every planned email — to `runs/<run_id>.md`.
Expected with the demo seed: **2 cold (one COLD-AGG via the bad-news flag), 1 follow-up,
1 final-push, 3 skips** (not due / terminal status / invalid email).

## With the real LLM gateway

```bash
pip install -e ".[live]"
# set LITELLM_BASE_URL in .env, then drop --no-llm:
python -m bazooka
```

Same dry run, but subject/body now come from the `deepseek` pre-send validator with the
production prompt (placeholder filling + sanity check + COLD-AGG news hook rules).

## Going live (later — not part of isolated testing)

1. `client_secret.json` (GCP OAuth desktop client, Gmail API enabled) into this folder.
2. `python -m bazooka.auth info` and `python -m bazooka.auth hanna` — one-time consent.
3. `WHATSAPP_API_KEY` (+ provider) in `.env`.
4. Supervised first run: `python -m bazooka --live --campaign "DEMO PL CYBERSECURITY" --limit 3`
5. Schedule: launchd plist calling `python -m bazooka --live` at 08:00 Europe/Berlin.

## Layout

| Path | Role (n8n equivalent) |
|---|---|
| `bazooka/settings.py` | Config — Globals node |
| `bazooka/db.py` | all Drive/Sheets nodes → SQL (contract in `schema.sql`) |
| `bazooka/domain/actions.py` | Code — Compute Action (the decision matrix, pure) |
| `bazooka/domain/hygiene.py` | email cleaning (the U+2011 Gmail-rejection fix) |
| `bazooka/clients/llm.py` | OpenAI — Pre-send Validate (same prompt, + offline mode) |
| `bazooka/clients/gmail.py` | Gmail — Send Outreach ×2 (info@/hanna routing) |
| `bazooka/clients/whatsapp.py` | WA — * nodes (Meta or 360dialog) |
| `bazooka/pipeline.py` | the loops, gates, counters, digests |
| `bazooka/report.py` | replaces the n8n executions view |
| `bazooka/cli.py` | triggers + error-trigger branch |
| `seed_demo.py` | isolated demo campaign |
