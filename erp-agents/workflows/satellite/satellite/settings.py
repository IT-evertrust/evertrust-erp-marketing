"""Run configuration for Satellite. Reads the central agents .env; talks to the ERP machine API."""
from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    # Load the per-agent .env (most specific) then the shared erp-agents/.env (central
    # defaults), so one central file works for every agent. setdefault means the process
    # environment wins over both, and the per-agent file wins over the central one.
    for env_file in (PACKAGE_ROOT / ".env", PACKAGE_ROOT.parent.parent / ".env"):
        if not env_file.exists():
            continue
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


@dataclass(frozen=True)
class Settings:
    erp_base_url: str = "http://localhost:3001"
    arsenal_token: str = ""
    searxng_url: str = ""
    searxng_api_key: str = ""   # sent as the X-Search-Key header to the searxng-auth proxy
    # Pinned SearXNG engines (comma-separated). Our instance disables google by default and the
    # remaining default mix returns off-topic junk (zhihu / support pages) for company discovery;
    # naming engines explicitly enables a disabled one and keeps results on-target. Empty = instance
    # default. Override with SEARXNG_ENGINES.
    searxng_engines: str = "google,bing,brave,duckduckgo"
    llm_base_url: str = ""
    llm_api_key: str = "sk-anything"
    lead_model: str = "hermes"  # n8n LEAD SATELLITE (PG) uses hermes
    email_model: str = "hermes"
    buzzword_model: str = "hermes"  # niche -> tender buzzwords
    # Country profiler = the ONE call that must know any country's regions+cities. Point it at a
    # bigger model over the gateway (e.g. qwen3 on the Mac via Tailscale) with PROFILE_MODEL; the
    # many cheap per-segment calls stay on the small model.
    profile_model: str = "hermes"
    report_dir: str = str(PACKAGE_ROOT / "runs")
    # Scraper tuning (all I/O-bound, safe to parallelize on a laptop).
    search_workers: int = 4     # concurrent discovery queries (DDG throttles aggressive bursts)
    scrape_workers: int = 14    # concurrent site fetches for email recovery
    max_scrape: int = 180       # cap sites scraped per run
    ddg_pages: int = 1          # DuckDuckGo result pages per query
    # Tender-hunter exhaustive discovery.
    lead_target: int = 100      # keep searching until at least this many candidates (or queries run out)
    search_pages: int = 2       # SearXNG result pages per query (pageno 1..n)
    max_queries: int = 240      # hard cap on discovery queries per run
    # Region-by-region nationwide sweep (port of n8n round-9: loop EVERY region of the AIM country,
    # one batch at a time, so each region gets its own query budget and the search backend isn't
    # overloaded). Region count is whatever the country has — not a fixed number.
    queries_per_region: int = 60   # query budget per region batch
    max_regions: int = 24          # cap regions scanned per run (bounds time for big countries)
    region_cooldown: float = 3.0   # seconds to pause between region batches (keeps SearXNG stable)
    region_chunk: int = 6          # cities per batch when the profiler returns a flat city list
    # How many cities the country profiler returns in total (the geo coverage ceiling). The profiler
    # asks the model for the largest cities/business towns per region; this caps the flattened list.
    # Raise for wider city coverage (more towns swept) at the cost of a longer run. Env: LEAD_PROFILE_MAX_CITIES.
    profile_max_cities: int = 80
    # Search-source policy: SearXNG-first. DDG is kept only as an OPTIONAL fallback (OFF by
    # default) so a weak DDG result set can't quietly displace/contaminate SearXNG hits when
    # SearXNG is reachable. With no SearXNG configured, DDG is still used as the keyless engine.
    enable_ddg_fallback: bool = False
    # Email policy: website scraping is evidence-based (the address is on a page we fetched) so it
    # stays ON. LLM email recovery can output an address that was never on the page, so it is OFF
    # by default — only real, sourced emails are accepted.
    enable_web_email_recovery: bool = True
    allow_llm_email_recovery: bool = False
    # Nationwide ("Anywhere"): keep sweeping ALL of the country's regions even after lead_target is
    # met, for exhaustive coverage (still bounded by max_regions). A specific region/city list is
    # unaffected (single batch).
    exhaust_anywhere_regions: bool = True
    # Lead-quality floor: the B/C tier boundary. A lead scoring below this is tier C (noise) and is
    # DROPPED — only B and above are kept/returned/posted. Raise to be stricter, lower to keep more.
    min_keep_score: int = 40
    # SCRAPE TIMEOUT (Config page, minutes -> seconds here): hard wall-clock cap on the discovery
    # sweep so a run can't grind forever. 0 = no limit. Env: LEAD_MAX_RUNTIME_SEC.
    max_runtime_sec: int = 0


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def load_settings() -> Settings:
    _load_dotenv()
    # ONE knob for everything: LEAD_MODEL (alias MODEL) is the model for every LLM step. Set it to
    # the strongest alias the Mac can serve (e.g. qwen3:32b via the gateway) and ALL steps use it.
    # Per-step env vars still override: EXTRACT_MODEL (lead/email), FORGE_MODEL (buzzwords/profile),
    # PROFILE_MODEL (country profiler only). Drop LEAD_MODEL one tier (a *:8b alias) if SearXNG /
    # latency gets tight. Code default stays 'hermes' so offline + tests need no gateway.
    _base = os.environ.get("LEAD_MODEL", os.environ.get("MODEL", "hermes"))
    _extract = os.environ.get("EXTRACT_MODEL", _base)
    _forge = os.environ.get("FORGE_MODEL", _extract)
    return Settings(
        erp_base_url=os.environ.get("ERP_BASE_URL", "http://localhost:3001"),
        arsenal_token=os.environ.get("ARSENAL_TOKEN", os.environ.get("ARSENAL_INGEST_TOKEN", "")),
        searxng_url=os.environ.get("SEARXNG_URL", ""),
        searxng_api_key=os.environ.get("SEARXNG_API_KEY", ""),
        searxng_engines=os.environ.get("SEARXNG_ENGINES", "google,bing,brave,duckduckgo"),
        llm_base_url=os.environ.get("LLM_BASE_URL", os.environ.get("LITELLM_BASE_URL", "")),
        llm_api_key=os.environ.get("LLM_API_KEY", os.environ.get("LITELLM_API_KEY", "sk-anything")),
        lead_model=_extract,
        email_model=_extract,
        buzzword_model=_forge,
        profile_model=os.environ.get("PROFILE_MODEL", _forge),
        search_workers=int(os.environ.get("LEAD_SEARCH_WORKERS", "4") or 4),
        scrape_workers=int(os.environ.get("LEAD_SCRAPE_WORKERS", "14") or 14),
        max_scrape=int(os.environ.get("LEAD_MAX_SCRAPE", "180") or 180),
        ddg_pages=int(os.environ.get("LEAD_DDG_PAGES", "1") or 1),
        lead_target=int(os.environ.get("LEAD_TARGET", "100") or 100),
        search_pages=int(os.environ.get("LEAD_SEARCH_PAGES", "2") or 2),
        max_queries=int(os.environ.get("LEAD_MAX_QUERIES", "240") or 240),
        queries_per_region=int(os.environ.get("LEAD_QUERIES_PER_REGION", "60") or 60),
        max_regions=int(os.environ.get("LEAD_MAX_REGIONS", "24") or 24),
        region_cooldown=float(os.environ.get("LEAD_REGION_COOLDOWN", "3") or 3),
        region_chunk=int(os.environ.get("LEAD_REGION_CHUNK", "6") or 6),
        profile_max_cities=int(os.environ.get("LEAD_PROFILE_MAX_CITIES", "80") or 80),
        enable_ddg_fallback=_env_bool("LEAD_ENABLE_DDG_FALLBACK", False),
        enable_web_email_recovery=_env_bool("LEAD_ENABLE_WEB_EMAIL_RECOVERY", True),
        allow_llm_email_recovery=_env_bool("LEAD_ALLOW_LLM_EMAIL_RECOVERY", False),
        exhaust_anywhere_regions=_env_bool("LEAD_EXHAUST_ANYWHERE_REGIONS", True),
        min_keep_score=int(os.environ.get("LEAD_MIN_KEEP_SCORE", "40") or 40),
        max_runtime_sec=int(os.environ.get("LEAD_MAX_RUNTIME_SEC", "0") or 0),
    )


def with_llm_override(
    s: Settings,
    base_url: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> Settings:
    """Apply a per-request LLM override (from the ERP dispatch / AI Engine page) over
    the agent's env-resolved settings. Each field falls back to the env default when
    the request omits it (request value ?? env). Model maps to every per-step model
    field so the org's choice drives the whole run."""
    changes: dict = {}
    if base_url:
        changes["llm_base_url"] = base_url
    if api_key:
        changes["llm_api_key"] = api_key
    if model:
        changes.update(lead_model=model, email_model=model, buzzword_model=model)
    return replace(s, **changes) if changes else s


def with_scraper_override(
    s: Settings,
    lead_target: int | None = None,
    max_queries: int | None = None,
    min_score: int | None = None,
    scrape_timeout_min: int | None = None,
) -> Settings:
    """Apply a per-request Lead Scraper override (from the ERP dispatch / Configuration
    page) over the agent's env-resolved tuning. Each field falls back to the env default
    when the request omits it (request value ?? env). lead_target = how many leads to
    hunt; max_queries = search budget; min_score = the tier-floor; scrape_timeout_min =
    wall-clock cap (minutes) on the discovery sweep."""
    changes: dict = {}
    if lead_target is not None:
        changes["lead_target"] = lead_target
    if max_queries is not None:
        changes["max_queries"] = max_queries
    if min_score is not None:
        changes["min_keep_score"] = min_score
    if scrape_timeout_min is not None:
        changes["max_runtime_sec"] = max(0, int(scrape_timeout_min)) * 60
    return replace(s, **changes) if changes else s
