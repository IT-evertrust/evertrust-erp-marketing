"""Ad-hoc driver: run Lead Satellite + the new QUALIFY stage for ONE niche locally, no live ERP.

- Mocks the ERP gateway so fetch_campaign_config returns the AIM modal's values.
- LLM (profiler) = qwen2.5:32b on the Mac Pro; search = local SearXNG; dry run (persist=False).
- After discovery, builds an ICP DYNAMICALLY from the AIM niche's own keywords (nothing hardcoded),
  crawls each company, and runs qualify() -> tiers + splits into 5 buckets, one CSV each.

Scoped for a demo (a few regions), not the full 16-Bundesland sweep.
"""
from __future__ import annotations

import csv
import json
import os
import sys
import time
from dataclasses import replace

# Windows console is cp1252; company names carry arbitrary unicode (⇒, ü, …). Don't let a
# print crash the run after the work is done.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from satellite.clients.render import PlaywrightRenderer
from satellite.clients.search import HttpFetcher, WebSearch
from satellite.domain.models import CampaignConfig
from satellite.pipeline import RunOptions, run
from satellite.refine import expand_via_hubs, refine_prospects  # noqa: F401 (re-export for tests)
from satellite.settings import load_settings

# ---- AIM modal values (edit these to match the AIM target dialog) ----------------
CAMPAIGN_ID = "housing-co-op-bayern-2026"
CFG = CampaignConfig(
    campaign_id=CAMPAIGN_ID,
    niche="Public Housing",     # AIM niche=Housing + segment=Public Housing -> co-ops / social housing
    industry="Real Estate",
    niche_id=None,
    niche_slug="public-housing",
    targets=[],                 # no curated targets -> niche-as-target fallback
    region="Bayern",            # AIM region "Bavaria" -> canonical Bundesland name for German search
    country="Germany",
    project="Housing co-op",
    default_regions=[],
    max_leads_per_run=500,
)


class MockErp:
    """Stand-in for the ERP machine API — returns the campaign config, swallows writes."""

    def fetch_campaign_config(self, campaign_id: str) -> CampaignConfig:
        return CFG

    def post_prospects_bulk(self, campaign_id: str, prospects: list) -> dict:
        return {"data": {"created": 0, "updated": 0}}

    def post_run_callback(self, campaign_id: str, metrics: dict, status: str = "SUCCESS") -> dict:
        return {"ok": True}

    def trigger_niche_analytics(self, campaign_id: str) -> dict:
        return {"status": 200}


def main() -> int:
    # NOTE: the profiler is now multi-round (each call small, with its own short timeout), so the
    # old global 600s _client override is gone — per-company classify keeps the safe 45s cap and
    # can't hang the run for an hour.
    s = load_settings()
    # Repoint the dead-Mac-mini config at local hermes; force DDG (SearXNG offline); scope the run.
    s = replace(
        s,
        llm_base_url="http://100.93.32.103:11434/v1",   # Mac Pro (32b)
        llm_api_key="sk-anything",
        lead_model="qwen2.5:32b",
        email_model="qwen2.5:32b",
        buzzword_model="qwen2.5:32b",
        profile_model="qwen2.5:32b",
        # SEARXNG_URL + SEARXNG_API_KEY come from .env (load_settings) — no secrets hardcoded here.
        enable_ddg_fallback=False,              # SearXNG-first; no DDG contamination
        # --- wider Bayern dig (more candidates -> more qualified companies) ---
        max_regions=3,                  # n/a for a single specific region (Bayern = 1 scan)
        queries_per_region=32,          # was 12 — more search angles per region
        search_pages=3,                 # was 1 — go deeper into the result pages
        exhaust_anywhere_regions=False,  # stop once target met
        lead_target=80,                 # was 20 — collect many more before qualify gates
        max_scrape=220,                 # was 60 — crawl far more candidate sites
        scrape_workers=12,
        region_cooldown=1.0,
        min_keep_score=0,   # don't pre-cut with the OLD score; let qualify() do the real gating
    )

    print("=== Lead Satellite — scoped local run ===", flush=True)
    print(f"niche={CFG.niche!r} industry={CFG.industry!r} country={CFG.country!r} region={CFG.region!r}", flush=True)
    print(f"LLM={s.llm_base_url} model={s.lead_model} | search=SearXNG {s.searxng_url} | "
          f"max_regions={s.max_regions} q/region={s.queries_per_region} target={s.lead_target}", flush=True)
    print("running... (a few minutes; profiler + region sweeps over DDG)\n", flush=True)

    opts = RunOptions(campaign_id=CAMPAIGN_ID, live=False, persist=False, use_llm=True)
    erp = MockErp()
    search = WebSearch(s.searxng_url, s.searxng_api_key, pages=s.ddg_pages, enable_ddg=s.enable_ddg_fallback)
    fetcher = HttpFetcher()
    renderer = PlaywrightRenderer()   # headless Chromium for JS-rendered hub pages (graceful no-op if absent)
    t = time.time()
    try:
        result = run(s, opts, erp, search, fetcher)
        raw = result.get("leads", [])
        print(f"\nqualifying {len(raw)} candidates + mining on-niche hubs (same code as production "
              f"pipeline.run -> refine_prospects)...", flush=True)
        # IDENTICAL quality stage to production: qualify (entity/niche/geo/tier) + hub expansion with
        # JS-render fallback + resilient Mac-only classifier. ICP/classifier/guards all live in refine.
        ref = refine_prospects(raw, settings=s, fetcher=fetcher, renderer=renderer,
                               niche=CFG.niche, country=CFG.country,
                               market_tld=result.get("marketTld", ""), buzz=result.get("buzzList"))
        leads = ref["qualified"]
        n_excluded = ref["excluded"]
        print(f"[hubs] {ref['hubsMined']} core hub(s) mined -> {ref['hubCompanies']} member companies",
              flush=True)
    finally:
        search.close()
        fetcher.close()
        renderer.close()
    dt = time.time() - t

    result.pop("leads", None)
    print("=== RESULT (%.1fs) ===" % dt, flush=True)
    print(json.dumps(result, indent=2, ensure_ascii=False), flush=True)

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")
    os.makedirs(out_dir, exist_ok=True)
    stem = f"leads_{CFG.niche}_{CFG.country}_{result['runId']}".replace(" ", "-").lower()

    # The deliverable = ONE simple lead file: the QUALIFIED companies (real company + on-niche),
    # best-first. refine_prospects already ranked them; we just write the columns.

    cols = ["ranking", "tier", "score", "companyName", "foundedYear", "employees",
            "email", "emailStatus", "city", "country", "website"]
    main = os.path.join(out_dir, stem + ".csv")
    with open(main, "w", newline="", encoding="utf-8-sig") as f:    # utf-8-sig for Excel umlauts
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for p in leads:
            w.writerow({c: p.get(c, "") for c in cols})
    # NOTE: the "_excluded.csv" side file (filtered-out / non-company pages) is intentionally NOT
    # written — the user only wants the clean qualified-lead file, no junk reference file.

    print(f"\n=== LEADS ({len(leads)} qualified · {n_excluded} filtered out, not written) ===", flush=True)
    for p in leads[:40]:
        print(f"  #{p.get('ranking'):>2} [{p.get('tier'):>3}] {p.get('companyName', '')[:46]:46} | "
              f"{p.get('email', '') or '-':32} | {p.get('website', '')}", flush=True)
    print(f"\nFILE: {main}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
