"""Run configuration for Satellite. Reads the central agents .env; talks to the ERP machine API."""
from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env_file = PACKAGE_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
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
    llm_base_url: str = ""
    llm_api_key: str = "sk-anything"
    lead_model: str = "hermes"  # n8n LEAD SATELLITE (PG) uses hermes
    email_model: str = "hermes"
    buzzword_model: str = "hermes"  # niche -> tender buzzwords
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


def load_settings() -> Settings:
    _load_dotenv()
    return Settings(
        erp_base_url=os.environ.get("ERP_BASE_URL", "http://localhost:3001"),
        arsenal_token=os.environ.get("ARSENAL_TOKEN", os.environ.get("ARSENAL_INGEST_TOKEN", "")),
        searxng_url=os.environ.get("SEARXNG_URL", ""),
        searxng_api_key=os.environ.get("SEARXNG_API_KEY", ""),
        llm_base_url=os.environ.get("LLM_BASE_URL", os.environ.get("LITELLM_BASE_URL", "")),
        llm_api_key=os.environ.get("LLM_API_KEY", os.environ.get("LITELLM_API_KEY", "sk-anything")),
        lead_model=os.environ.get("EXTRACT_MODEL", "hermes"),
        email_model=os.environ.get("EXTRACT_MODEL", "hermes"),
        buzzword_model=os.environ.get("FORGE_MODEL", os.environ.get("EXTRACT_MODEL", "hermes")),
        search_workers=int(os.environ.get("LEAD_SEARCH_WORKERS", "4") or 4),
        scrape_workers=int(os.environ.get("LEAD_SCRAPE_WORKERS", "14") or 14),
        max_scrape=int(os.environ.get("LEAD_MAX_SCRAPE", "180") or 180),
        ddg_pages=int(os.environ.get("LEAD_DDG_PAGES", "1") or 1),
        lead_target=int(os.environ.get("LEAD_TARGET", "100") or 100),
        search_pages=int(os.environ.get("LEAD_SEARCH_PAGES", "2") or 2),
        max_queries=int(os.environ.get("LEAD_MAX_QUERIES", "240") or 240),
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
