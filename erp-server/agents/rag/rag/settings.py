"""Run configuration. Run-level constants mirror the n8n 'Campaign Config' node; secrets
come from env. Reads .env in the package root (same convention as the other agents).

The n8n 'hermesBaseUrl' / 'hermesModel' vars were dead placeholders — the real call went
through the LiteLLM credential with model id 'hermes'. We keep only the live values."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
TZ = "Europe/Berlin"


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
    llm_base_url: str = ""
    llm_api_key: str = "sk-anything"
    llm_model: str = "hermes"
    google_client_secret_file: str = str(PACKAGE_ROOT / "client_secret.json")
    gmail_token_dir: str = str(PACKAGE_ROOT / "tokens")
    sender_addresses: dict = field(default_factory=lambda: {
        "info": "info@evertrust-germany.de",
        "hanna": "hanna@evertrust-germany.de",
    })
    # caps — verbatim from the n8n nodes (Cap Per Run / Build Thread Context / HTML to Text)
    per_run_cap: int = 10
    thread_msgs_cap: int = 20
    body_cap: int = 2000
    knowledge_cap: int = 150000
    report_dir: str = str(PACKAGE_ROOT / "runs")


def load_settings() -> Settings:
    _load_dotenv()
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set. Put it in rag/.env or the environment.")
    return Settings(
        database_url=database_url,
        llm_base_url=os.environ.get("LLM_BASE_URL", ""),
        llm_api_key=os.environ.get("LLM_API_KEY", "sk-anything"),
        llm_model=os.environ.get("LLM_MODEL", "hermes"),
    )
