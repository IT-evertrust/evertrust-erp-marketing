"""Ad-hoc driver: run Lead Satellite for the AIM "IT CB Germany 2026" locally, no live ERP.

AIM (from the New Reach Aim modal):
  Campaign Name = IT CB Germany 2026
  Niche         = IT > Cybersecurity   (niche=Cybersecurity, sector/industry=IT)
  Region        = Anywhere             (nationwide DE — profiler supplies real regions/cities)
  Country       = Germany              (hardcoded by the trimmed modal)
  Segment       = (blank)              -> run full, niche-as-target fallback

Mocks the ERP so the campaign config = the AIM values; dry run (persist=False).
LLM = qwen2.5:32b on the Mac Pro (tailnet); search = SearXNG (google-only, from .env).
After discovery -> identical production quality stage (refine_prospects: qualify + hub mining)
-> one CSV of qualified companies, best-first.
"""
from __future__ import annotations

import csv
import json
import os
import sys
import time
from dataclasses import replace

# Windows console is cp1252; company names carry arbitrary unicode. Don't let a print crash
# the run after the work is done.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from satellite.clients.render import PlaywrightRenderer
from satellite.clients.search import HttpFetcher, WebSearch
from satellite.domain.models import CampaignConfig
from satellite.pipeline import RunOptions, run
from satellite.refine import refine_prospects
from satellite.settings import load_settings

# ---- AIM modal values ------------------------------------------------------------
CAMPAIGN_ID = "it-cb-germany-2026"
CFG = CampaignConfig(
    campaign_id=CAMPAIGN_ID,
    niche="Cybersecurity",
    industry="IT",
    niche_id=None,
    niche_slug="cybersecurity",
    targets=[],                 # blank segment -> niche-as-target fallback (run full)
    region="Anywhere",          # nationwide DE
    country="Germany",
    project="IT CB Germany 2026",
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
    s = load_settings()  # loads satellite/.env (SEARXNG_URL/KEY/ENGINES, etc.)
    # Point the LLM at the Mac Pro 32B (back online); keep SearXNG google-only; bound the run.
    s = replace(
        s,
        llm_base_url="http://100.93.32.103:11434/v1",   # Mac Pro (qwen2.5:32b)
        llm_api_key="sk-anything",
        lead_model="qwen2.5:32b",
        email_model="qwen2.5:32b",
        buzzword_model="qwen2.5:32b",
        profile_model="qwen2.5:32b",
        # ===== MULTI-COUNTRY SAFE config (2026-06-26 rework) =====
        # multi-engine does NOT lighten google (every query still hits google) — it only adds
        # off-topic global junk. So google-only: same rate-limit exposure, clean results.
        # google still IP-blocked at google's end (SearXNG restart doesn't reset that). bing/brave/ddg
        # work — and their off-topic global junk is a HARD adversarial test of the new LLM gate:
        # if classify_company EXCLUDEs the junk (nicheFit=none), the multi-country focus is proven.
        searxng_engines="bing,brave,duckduckgo",
        enable_ddg_fallback=False,
        # Sweep ALL regions (geodata, pop-sorted) but cap TOTAL queries so no country's sweep
        # hammers google into a CAPTCHA. Budget spreads thin across every region (breadth>depth).
        exhaust_anywhere_regions=True,
        max_regions=0,                      # all regions of the country (not just a top-N)
        queries_per_region=12,              # shallow per region
        max_queries=200,                    # HARD total-query cap = the rate-limit safety (any country)
        search_pages=2,
        profile_max_cities=250,
        lead_target=100000,
        max_scrape=2000,
        scrape_workers=14,
        region_cooldown=4.0,
        min_keep_score=0,
        max_runtime_sec=0,
    )

    print("=== Lead Satellite — IT CB Germany 2026 (nationwide, dry) ===", flush=True)
    print(f"niche={CFG.niche!r} sector={CFG.industry!r} country={CFG.country!r} region={CFG.region!r}", flush=True)
    print(f"LLM={s.llm_base_url} model={s.lead_model} | search=SearXNG {s.searxng_url} engines={s.searxng_engines} | "
          f"max_regions={s.max_regions} q/region={s.queries_per_region} target={s.lead_target} "
          f"deadline={s.max_runtime_sec}s", flush=True)
    print("running... (nationwide sweep + per-company 32B classify; several minutes)\n", flush=True)

    opts = RunOptions(campaign_id=CAMPAIGN_ID, live=False, persist=False, use_llm=True)
    erp = MockErp()
    search = WebSearch(s.searxng_url, s.searxng_api_key, pages=s.ddg_pages,
                       enable_ddg=s.enable_ddg_fallback, engines=s.searxng_engines)
    fetcher = HttpFetcher()
    renderer = PlaywrightRenderer()   # headless Chromium for JS hub pages (graceful no-op if absent)
    t = time.time()
    try:
        result = run(s, opts, erp, search, fetcher)
        raw = result.get("leads", [])
        print(f"\nqualifying {len(raw)} candidates + mining on-niche hubs "
              f"(same code as production pipeline.run -> refine_prospects)...", flush=True)
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

    cols = ["ranking", "tier", "score", "companyName",
            "email", "emailStatus", "emailSourceType", "emailConfidence", "city", "country", "website"]
    main_csv = os.path.join(out_dir, stem + ".csv")
    with open(main_csv, "w", newline="", encoding="utf-8-sig") as f:   # utf-8-sig for Excel umlauts
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for p in leads:
            w.writerow({c: p.get(c, "") for c in cols})

    print(f"\n=== LEADS ({len(leads)} qualified · {n_excluded} filtered out) ===", flush=True)
    for p in leads[:60]:
        print(f"  #{p.get('ranking'):>2} [{str(p.get('tier')):>3}] {str(p.get('companyName',''))[:46]:46} | "
              f"{str(p.get('email','') or '-'):32} | {p.get('website','')}", flush=True)
    print(f"\nFILE: {main_csv}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
