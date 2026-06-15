"""Run configuration. Reach talks to the EVERTRUST ERP machine API; secrets come from env.

Reads .env in the package root if present (no python-dotenv dependency).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
TZ = "Europe/Berlin"  # n8n workflow timezone


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
    # ERP machine API (the data layer reach reads/writes)
    erp_base_url: str = "http://localhost:3001"
    arsenal_token: str = ""
    # WhatsApp notifications (optional)
    manager_whatsapp_number: str = "84333634500"
    sender_phone_number_id: str = "1030239273516528"
    whatsapp_provider: str = "meta"  # 'meta' | '360dialog'
    whatsapp_api_key: str = ""
    # LLM personalization (LiteLLM gateway on the mac-mini)
    litellm_base_url: str = ""
    litellm_api_key: str = "sk-anything"
    llm_model: str = "deepseek"
    # Gmail OAuth artifacts (live sends only)
    google_client_secret_file: str = str(PACKAGE_ROOT / "client_secret.json")
    gmail_token_dir: str = str(PACKAGE_ROOT / "tokens")
    sender_addresses: dict = field(
        default_factory=lambda: {
            "info": "info@evertrust-germany.de",
            "hanna": "hanna@evertrust-germany.de",
        }
    )
    signature_img_url: str = "https://lh3.googleusercontent.com/d/1mNy9SN_iJjuw_ZgbNCwSepeF8YnozyvE"
    report_dir: str = str(PACKAGE_ROOT / "runs")


def load_settings() -> Settings:
    _load_dotenv()
    return Settings(
        erp_base_url=os.environ.get("ERP_BASE_URL", "http://localhost:3001"),
        arsenal_token=os.environ.get("ARSENAL_TOKEN", os.environ.get("ARSENAL_INGEST_TOKEN", "")),
        manager_whatsapp_number=os.environ.get("MANAGER_WHATSAPP_NUMBER", "84333634500"),
        sender_phone_number_id=os.environ.get("SENDER_PHONE_NUMBER_ID", "1030239273516528"),
        whatsapp_provider=os.environ.get("WHATSAPP_PROVIDER", "meta"),
        whatsapp_api_key=os.environ.get("WHATSAPP_API_KEY", ""),
        litellm_base_url=os.environ.get("LITELLM_BASE_URL", ""),
        litellm_api_key=os.environ.get("LITELLM_API_KEY", "sk-anything"),
        llm_model=os.environ.get("LLM_MODEL", "deepseek"),
    )
