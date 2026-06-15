"""Run configuration. Per-campaign values come from the campaigns table; everything here
is environment-level. Reads .env in the package root (same convention as bazooka)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
ACCEPT_LANG = "pl,de;q=0.9,en;q=0.8"


def _load_dotenv() -> None:
    env_file = PACKAGE_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    database_url: str
    # LLM (profiler + extractor) — LiteLLM gateway or any OpenAI-compatible endpoint
    llm_base_url: str = ""
    llm_api_key: str = "sk-anything"
    extract_model: str = "hermes"
    # SearXNG self-hosted search; empty = DDG/Mojeek only
    searxng_url: str = ""
    # politeness (n8n: SERP 1 req/2.2s; site fetches 2/700ms)
    serp_delay_s: float = 2.2
    fetch_workers: int = 6
    serp_timeout_s: float = 15.0
    homepage_timeout_s: float = 10.0
    contact_timeout_s: float = 8.0
    report_dir: str = str(PACKAGE_ROOT / "runs")


def load_settings() -> Settings:
    _load_dotenv()
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise SystemExit(
            "DATABASE_URL is not set. Put it in satellite/.env or the environment."
        )
    return Settings(
        database_url=database_url,
        llm_base_url=os.environ.get("LLM_BASE_URL", ""),
        llm_api_key=os.environ.get("LLM_API_KEY", "sk-anything"),
        extract_model=os.environ.get("EXTRACT_MODEL", "hermes"),
        searxng_url=os.environ.get("SEARXNG_URL", "").rstrip("/"),
        serp_delay_s=float(os.environ.get("SERP_DELAY_S", "2.2")),
    )
