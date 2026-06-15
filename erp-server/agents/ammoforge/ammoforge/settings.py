from __future__ import annotations

import os
from dataclasses import dataclass
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
    database_url: str
    llm_base_url: str = ""
    llm_api_key: str = "sk-anything"
    news_model: str = "hermes"        # n8n: hermes via LiteLLM gateway
    forge_model: str = "deepseek"     # n8n: deepseek via LiteLLM gateway
    report_dir: str = str(PACKAGE_ROOT / "runs")


def load_settings() -> Settings:
    _load_dotenv()
    db = os.environ.get("DATABASE_URL", "")
    if not db:
        raise SystemExit("DATABASE_URL is not set. Put it in ammoforge/.env or the environment.")
    return Settings(
        database_url=db,
        llm_base_url=os.environ.get("LLM_BASE_URL", ""),
        llm_api_key=os.environ.get("LLM_API_KEY", "sk-anything"),
        news_model=os.environ.get("NEWS_MODEL", "hermes"),
        forge_model=os.environ.get("FORGE_MODEL", "deepseek"),
    )
