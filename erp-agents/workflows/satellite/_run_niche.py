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

from satellite.clients import llm
from satellite.clients.search import HttpFetcher, WebSearch
from satellite.domain.icp import build_icp
from satellite.domain.models import CampaignConfig
from satellite.pipeline import RunOptions, run
from satellite.qualify import qualify
from satellite.settings import load_settings

# ---- AIM modal values (edit these to match the AIM target dialog) ----------------
CAMPAIGN_ID = "sd-germany-2026"
CFG = CampaignConfig(
    campaign_id=CAMPAIGN_ID,
    niche="Software Development",
    industry="IT",
    niche_id=None,
    niche_slug="software-development",
    targets=[],                 # no curated targets -> niche-as-target fallback
    region="Anywhere",          # nationwide
    country="Germany",
    project="SD Germany 2026",
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
        searxng_url="http://localhost:8080",   # <- LOCAL SearXNG (replaces the offline mini)
        searxng_api_key="",                     # no auth proxy locally
        enable_ddg_fallback=False,              # SearXNG-first; no DDG contamination
        # --- scope for a quick demo run ---
        max_regions=3,                  # sweep 3 regions, not all 16 Bundeslander
        queries_per_region=12,
        search_pages=1,
        exhaust_anywhere_regions=False,  # stop once target met
        lead_target=20,
        max_scrape=60,
        scrape_workers=10,
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
    t = time.time()
    try:
        result = run(s, opts, erp, search, fetcher)
        leads = result.get("leads", [])
        # ICP built DYNAMICALLY from the AIM niche's own keywords — niche-agnostic, nothing hardcoded
        icp = build_icp(CFG.niche, CFG.country, buzz=result.get("buzzList"))
        # Per-company entity + niche-fit judged by qwen2.5:32b (more accurate than 8B at telling a
        # real vendor from a retailer / therapy clinic / directory), reading each page in its own
        # language (Polish here) — no hardcoded per-language lists. 45s cap per call (no hang).
        # RESILIENT classify: try qwen2.5:32b @ Mac Pro (accurate, 45s covers a cold load); if Mac Pro
        # is flaky/down, fall back to hermes3:8b LOCAL (always up, good filtering) — NEVER the weak
        # rule path. Circuit breaker: after 3 consecutive Mac-Pro misses, switch to local hermes for
        # the rest, so a dropped Mac Pro can't hang the run for an hour.
        s_local = replace(s, llm_base_url="http://localhost:11434/v1", lead_model="hermes3:8b")
        cb = {"qwen_dead": False, "fails": 0}

        def classify(name, url, text):
            if not cb["qwen_dead"]:
                r = llm.classify_company(s, name, url, text, CFG.niche, CFG.country, timeout=45)
                if r:
                    cb["fails"] = 0
                    return r
                cb["fails"] += 1
                if cb["fails"] >= 3:
                    cb["qwen_dead"] = True   # Mac Pro flaky -> stop hammering it; local hermes for rest
            return llm.classify_company(s_local, name, url, text, CFG.niche, CFG.country, timeout=30)

        print(f"\nqualifying {len(leads)} candidates (crawl + LLM entity/niche judge + geo gate)...",
              flush=True)
        buckets = qualify(leads, fetcher, icp, country=CFG.country,
                          market_tld=result.get("marketTld", ""), workers=10, classifier=classify)
    finally:
        search.close()
        fetcher.close()
    dt = time.time() - t

    result.pop("leads", None)
    print("=== RESULT (%.1fs) ===" % dt, flush=True)
    print(json.dumps(result, indent=2, ensure_ascii=False), flush=True)

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")
    os.makedirs(out_dir, exist_ok=True)
    stem = f"leads_{CFG.niche}_{CFG.country}_{result['runId']}".replace(" ", "-").lower()

    # The deliverable = ONE simple lead file (like the earlier good run): the QUALIFIED companies
    # (real company + on-niche, not EXCLUDE), best tier first. Quality gating still happened upstream
    # in qualify(); we just don't show the gate internals. Filtered-out rows go to a side file.
    _rk = {"AAA": 4, "AA": 3, "A": 2, "B": 1}
    leads = [p for k in ("contacts", "generic", "qualified_no_email") for p in buckets.get(k, [])]
    leads.sort(key=lambda p: (_rk.get(p.get("tier"), 0), p.get("nicheHits", 0)), reverse=True)
    for i, p in enumerate(leads):
        p["ranking"] = i + 1
    excluded = buckets.get("rejected", []) + buckets.get("source_ref", [])

    cols = ["ranking", "tier", "companyName", "email", "emailStatus", "city", "country", "website"]
    main = os.path.join(out_dir, stem + ".csv")
    with open(main, "w", newline="", encoding="utf-8-sig") as f:    # utf-8-sig for Excel umlauts
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for p in leads:
            w.writerow({c: p.get(c, "") for c in cols})
    # side file (reference only — what was filtered out + why), so nothing is silently lost
    with open(os.path.join(out_dir, stem + "_excluded.csv"), "w", newline="", encoding="utf-8-sig") as f:
        ec = ["companyName", "entity", "tierReason", "website"]
        w = csv.DictWriter(f, fieldnames=ec, extrasaction="ignore")
        w.writeheader()
        for p in excluded:
            w.writerow({c: p.get(c, "") for c in ec})

    print(f"\n=== LEADS ({len(leads)} qualified · {len(excluded)} filtered out) ===", flush=True)
    for p in leads[:40]:
        print(f"  #{p.get('ranking'):>2} [{p.get('tier'):>3}] {p.get('companyName', '')[:46]:46} | "
              f"{p.get('email', '') or '-':32} | {p.get('website', '')}", flush=True)
    print(f"\nFILE: {main}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
