# AMMO FORGE — Blueprint (ERP / PG)

**Spec:** n8n workflow `rDLhY3sqi6U9xK6t` — *EVERTRUST - AMMO FORGE (PG) v2* (13 nodes, active).
**Python:** `erp-server/agents/ammoforge/` (ERP-native; mirrors the reach pattern).
**Role in the pipeline:** generates a campaign's cold-outreach **template** (one tagged
`[COLD]/[FOLLOWUP]/[FINALPUSH]` sequence) + a **newsBrief**, and writes them to the ERP campaign
config. Reach (bazooka) later parses `coldEmail` into the three blocks; Reply Glock consumes
`newsBrief`.

> This supersedes the old Drive-era AMMO FORGE blueprint. No Google Drive, no Sheets, no Neon —
> the ERP machine API is the data layer.

## Trigger & I/O
- **Trigger:** per-campaign. n8n = webhook `POST /webhook/wf4-ammo-forge-pg` body `{ campaignId }`
  (responds `{accepted:true}` immediately, then runs). Python = `POST /ammoforge/run { campaignId }`.
- **Input:** `campaignId`.
- **Output (Python):** `{ runId, mode, campaignId, name, niche, status, templates:{coldEmail,newsBrief}, posted, notified }`.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /campaigns/:id/config` | campaign niche/country/region/project + `automation.templates` admin overrides |
| `POST /campaigns/:id/templates` body `{ templates: { coldEmail, newsBrief } }` | write the forged templates |
| `POST /notifications` `{ type:"TEMPLATES_READY", title, body, link, campaignId }` | best-effort UI ping |

## Logic (two LLM steps, prompts kept verbatim with the workflow)
1. **Research demand drivers** (`research_model`, default `hermes`): market-intelligence prose —
   recent BAD-news demand drivers whose causal chain ends in *more German public-sector tender
   demand* for the niche. (n8n uses OpenAI web-search as a built-in tool; through the LiteLLM
   gateway that tool may be absent, so the Python port issues a plain completion — wire a
   search-capable model to restore live web research.)
2. **Forge templates** (`forge_model`, default `hermes`, `response_format=json_object`): senior
   B2B copywriter reproducing the EXACT 3-block template, weaving the strongest demand driver
   into the `[COLD]` opening, and returning strict JSON `{coldEmail, newsBrief}`.
   - **Admin overrides** from `config.automation.templates`: `tone`, `language` (en/de),
     `signature` (verbatim sign-off), and baseline `default.{cold,followup,finalPush}.{subject,body}`.
     `"(none)"` = keep defaults. Tags/labels/`{{placeholders}}` are never translated.
3. **Parse (fail loud)** — `domain/models.parse_forge_json`: strip fences, extract first `{…}`,
   require non-empty `coldEmail` + `newsBrief`, else raise (→ run returns `status:"error"`).

## Template contract
- `coldEmail` = one string with literal `[COLD]` / `[FOLLOWUP]` / `[FINALPUSH]` tags, each with
  `Subject:` / `Body:` lines, `{{Company Name}}` placeholders verbatim, sign-off
  `Hanna Nguyen / EVERTRUST GmbH / We are at your disposal.`
- `newsBrief` = 200–400 word internal demand-driver brief.

## Python implementation map
- `clients/erp.py` — `ErpGateway` Protocol + `ErpClient` (the 3 calls above); injectable for tests.
- `clients/llm.py` — `research_demand_drivers`, `forge_templates`; `offline_research`/`offline_forge`
  for `--no-llm`/tests.
- `domain/models.py` — `CampaignConfig`, `ForgeResult`, `parse_forge_json`.
- `pipeline.py` — `run(settings, opts, erp)`: config → research → forge → (live) post + notify.
- `server.py` — `POST /ammoforge/run`, `GET /health`; `get_erp` injectable dep.
- `settings.py` — central `.env` (`ERP_BASE_URL`, `ARSENAL_TOKEN`, `LLM_BASE_URL/KEY`, models).
- `cli.py` — `python -m ammoforge --campaign-id <id> [--no-llm] [--live]`.

## Behaviour
- **Dry-run (default):** research + forge, returns templates, **no ERP writes**.
- **--live:** `POST /campaigns/:id/templates` then best-effort `POST /notifications`.
- **Fail loud** on unparseable forge output (no partial writes); notification is best-effort.

## Tests (`tests/`, all green)
- `test_parse.py` — `parse_forge_json` robust extraction + fail-loud.
- `test_route_run.py` — route → forge → output via TestClient + FakeErp: dry (templates, no writes),
  live (posts templates + `TEMPLATES_READY`), missing campaignId → error.

## Credentials
- ERP `ARSENAL_TOKEN` (= server `ARSENAL_INGEST_TOKEN`).
- LiteLLM gateway (`LITELLM_BASE_URL`/`_API_KEY`) for real forging (`--no-llm` works without).

## Gotchas
- Web search isn't available through a plain LiteLLM completion — research quality depends on
  the model/gateway; offline path is a deterministic stub.
- `coldEmail` must keep the tag/label structure exactly — reach's block parser depends on it.
