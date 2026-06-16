# SATELLITE — Python port of EVERTRUST - LEAD SATELLITE V2

Lead research pipeline, ported from n8n workflow `wKMX2cvDKlAc7p0N` ("Real Search +
Local AI"). Blueprint: `../lead-satellite-BLUEPRINT.md`. Reads campaigns from and writes
leads to the shared Postgres contract (`../bazooka/schema.sql` + `schema_additions.sql`).

**Flow:** campaign → country profile → search plan (cities × keywords) → multi-engine
SERP (SearXNG/DDG/Mojeek, retry-on-next-engine) → junk/niche filter + domain dedup →
fetch homepages → harvest emails (cfemail XOR decode, mailto, regex, contact-page
fallback) → local-LLM copy-only extraction with ID-join anti-fabrication → validate +
tier (B/A/AAA) → SERP email-recovery for NO_EMAIL rows → insert leads.

**Dry-run is the default** — the full hunt happens but no DB rows are written.

## Isolated test

```bash
cd satellite
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                                   # pure-logic tests, no network

# apply the leads-table additions to the shared test DB:
docker exec -i bazooka-pg-test psql -U postgres -d bazooka < schema_additions.sql

# tiny real hunt (hits real search engines, ~1 min, no LLM, no DB writes):
python -m satellite --campaign "DEMO PL CYBERSECURITY" \
  --max-cities 2 --queries-per-city 1 --max-candidates 12 --fast --no-llm
```

`--no-llm` swaps the extraction LLM for an accept-everything stub so the pipeline shape
can be tested without a gateway — its output is unjudged, so `--live --no-llm` is
forbidden by the CLI.

## Real runs

```bash
pip install -e ".[llm]"
# set LLM_BASE_URL (+ optionally SEARXNG_URL) in .env, then:
python -m satellite --campaign "PL CYBERSECURITY"            # dry-run with real extraction
python -m satellite --campaign "PL CYBERSECURITY" --live     # insert leads
python -m satellite --campaign "X" --live --force            # re-hunt, appends new domains only
```

Knobs (n8n config equivalents): `--queries-per-city` (2), `--max-queries` (600),
`--max-candidates` (1000), `--max-cities` (0=unlimited), `--extract-batch-size` (8).

## Differences vs the n8n original (deliberate)

- Drive/Sheets gone: campaign config comes from `campaigns`, output goes to `leads`
  (with `website/city/country/tier` columns). `Send From` column dropped — bazooka
  routes by `campaigns.sender`.
- Skip-if-exists guard checks the DB, not Drive; `--force` appends only NEW domains
  instead of creating a second sheet.
- The splitInBatches/Merge/`_kind`-multiplex plumbing is plain control flow; the
  index-alignment joins are a single Candidate object carried through the pipeline.
- Site fetches run on a small thread pool (6); SERP requests stay sequential at the
  same polite 2.2s the n8n version used.
