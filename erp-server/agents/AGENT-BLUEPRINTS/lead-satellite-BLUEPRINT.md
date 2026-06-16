# LEAD SATELLITE — Blueprint (ERP / PG)

**Spec:** n8n workflow `dCGzrlpaxpxJanbJ` — *EVERTRUST - LEAD SATELLITE copy 6 (PG)* (47 nodes).
**Python:** `erp-server/agents/satellite/` (ERP-native; reach pattern).
**Role:** hunts prospects (companies + emails) for a campaign's niche × cities and writes them to
the ERP. Feeds reach (prospects → send-list).

> Supersedes the Drive/Sheets/Neon satellite. No `leads.xlsx`, no Drive folders, no Neon — the
> ERP machine API is the data layer. The n8n fan-out (segment-worker child workflow, Data Table,
> Wait/poll batching) **collapses into a bounded in-process loop** — those existed only because
> n8n made concurrency hard.

## Trigger & I/O
- **Trigger:** per-campaign. n8n = webhook `wf03-lead-research-v2` body `{campaignId, source}`
  (AIM calls it). Python = `POST /satellite/run { campaignId }`.
- **Output:** `{ runId, mode, campaignId, niche, status, segmentsPlanned, leadsFound, prospects,
  verified, emailsRecovered, posted, metrics }`.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /campaigns/:id/config` | niche `{name,id,slug,targets[]}`, region, country, `automation.leads.{defaultRegions,maxLeadsPerRun}` |
| `POST /prospects/bulk` `{campaignId, prospects[]}` | upsert hunted prospects |
| `POST /arsenal/runs/callback` `{stage:"LEAD_SATELLITE", metrics:{prospectsUpserted, segmentsPlanned}}` | run report |
| `POST /niche-analytics` (trigger) | niche gate fallback when targets missing |

## Flow (faithful, machinery collapsed)
1. **Config** → `CampaignConfig` (niche, targets, region/cities, country, caps).
2. **Niche gate:** `niche.targets` empty → trigger NICHE ANALYTICS + return `status:"no_targets"`
   (n8n throws loud; it re-triggers when targets are ready).
3. **Build segments** (`domain.build_segments`): targets × cities × foci
   `[dir_consumer, dir_b2b, maps_assoc, broad]`. Cities from `region` (split) or
   `automation.leads.defaultRegions`. Caps preserved: `MAX_PAIRS=500`, `citiesPerTarget=500/T`,
   `segPerCity` 1–4 by city count, `maxSegments = maxLeadsPerRun || 500`.
4. **Per-segment research** (`clients/llm.research_leads`): LLM (hermes) grounded by `web_search`
   (SearXNG) → `{leads:[{name,type,email,website,city,country,sourceURL}]}`. Bounded loop
   (n8n's group fan-out / Data Table / Wait-poll is gone).
5. **Dedup** (`domain.dedup_leads`) by website domain / company name.
6. **Email recovery** (only the verified-email path counts later):
   a. LLM web-search for companies missing email (`recover_emails`, chunked);
   b. website scrape of `/kontakt /impressum /contact …` + **Cloudflare cfemail XOR decode**
      (`domain.extract_emails_from_html` / `decode_cf_email`), capped rows/time.
7. **Build prospects** (`domain.leads_to_prospects`): `emailVerified = email && !bad && status==''`;
   unverified prospects are sent with empty email (kept for the record).
8. **`POST /prospects/bulk`** → **run callback**.

## Python implementation map
- `domain/models.py` — `CampaignConfig`, `Segment`, `Lead`; pure ports: `norm_city`,
  `email_status`, `is_bad_email`, `decode_cf_email`, `extract_emails_from_html`,
  `build_segments`, `dedup_leads`, `leads_to_prospects`.
- `clients/erp.py` — `ErpGateway` + `ErpClient` (config / bulk / callback / niche trigger).
- `clients/search.py` — `SearchGateway` (`SearxngClient`) + `UrlFetcher` (`HttpFetcher`) +
  `OfflineSearch`/`OfflineFetcher` for tests.
- `clients/llm.py` — `research_leads`, `recover_emails`; `offline_research`/`offline_recover`.
- `pipeline.py` — `run(settings, opts, erp, search, fetcher)`.
- `server.py` — `POST /satellite/run`; injectable `get_erp`/`get_search`/`get_fetcher`.
- `settings.py` — central `.env` (`ERP_BASE_URL`, `ARSENAL_TOKEN`, `SEARXNG_URL`, `LLM_*`, models).
- `cli.py` — `python -m satellite --campaign-id <id> [--no-llm] [--max-segments N] [--live]`.

## Behaviour
- **Dry-run (default):** research + build prospects, **no ERP writes**.
- **--live:** `POST /prospects/bulk` + run callback.
- Niche gate returns `no_targets` (not a crash) so the route responds cleanly.

## Tests (`tests/`, all green — 11)
- `test_models.py` — norm_city, email_status, Cloudflare decode + HTML extraction, segment
  fan-out/caps, dedup + prospect mapping.
- `test_route_run.py` — route → satellite → output (FakeErp + offline search/fetcher): dry
  (segments/leads/prospects counts, no writes), live (bulk + callback), niche-gate `no_targets`.

## Credentials
- ERP `ARSENAL_TOKEN`; LiteLLM gateway (`LITELLM_BASE_URL/_API_KEY`); `SEARXNG_URL` (optional —
  empty disables web grounding). `--no-llm` runs fully offline.

## Notes / deferred
- The n8n agent calls `web_search` in a tool loop; the Python port grounds the model with
  injected `SearchGateway` results then asks for strict JSON. Real lead quality needs the LLM +
  SearXNG wired; offline path is deterministic for tests.
- Concurrency: the per-segment loop is sequential; add a bounded `asyncio`/thread pool later
  (the LLM box is the limit) — the n8n batched fan-out is intentionally not reproduced.
- The legacy Drive-poll / manual triggers and `leads.xlsx`/Sheets writes are dropped.
