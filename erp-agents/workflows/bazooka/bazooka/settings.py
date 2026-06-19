"""Run configuration. Reach talks to the EVERTRUST ERP machine API; secrets come from env.

Reads .env in the package root if present (no python-dotenv dependency). Globals mirror the
n8n workflow zyCTVLpZj3YyR2qV "Config — Globals" node.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
TZ = "Europe/Berlin"


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


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # ERP machine API
    erp_base_url: str = "http://localhost:3001"
    arsenal_token: str = ""
    # send governance (Config — Globals in the n8n workflow)
    max_sends_per_run: int = 25  # BAZOOKA_MAX_SENDS; per-campaign automation.leads.dailySendCap overrides
    send_list_limit: int = 50  # BAZOOKA_SEND_LIST_LIMIT; the /prospects limit
    # WhatsApp (optional manager pings)
    manager_whatsapp_number: str = "84333634500"
    sender_phone_number_id: str = "1030239273516528"
    whatsapp_provider: str = "meta"
    whatsapp_api_key: str = ""
    # LLM personalization (LiteLLM gateway; n8n uses model 'hermes')
    litellm_base_url: str = ""
    litellm_api_key: str = "sk-anything"
    llm_model: str = "hermes"
    # Gmail OAuth artifacts (live sends only)
    google_client_secret_file: str = str(PACKAGE_ROOT / "client_secret.json")
    gmail_token_dir: str = str(PACKAGE_ROOT / "tokens")
    sender_addresses: dict = field(
        default_factory=lambda: {
            "info": "info@evertrust-germany.de",
            "hanna": "hanna@evertrust-germany.de",
            "me": "lquan.du05@gmail.com",
        }
    )
    signature_img_url: str = "https://lh3.googleusercontent.com/d/1mNy9SN_iJjuw_ZgbNCwSepeF8YnozyvE"
    report_dir: str = str(PACKAGE_ROOT / "runs")


def load_settings() -> Settings:
    _load_dotenv()
    return Settings(
        erp_base_url=os.environ.get("ERP_BASE_URL", "http://localhost:3001"),
        arsenal_token=os.environ.get("ARSENAL_TOKEN", os.environ.get("ARSENAL_INGEST_TOKEN", "")),
        max_sends_per_run=_int_env("BAZOOKA_MAX_SENDS", 25),
        send_list_limit=_int_env("BAZOOKA_SEND_LIST_LIMIT", 50),
        manager_whatsapp_number=os.environ.get("MANAGER_WHATSAPP_NUMBER", "84333634500"),
        sender_phone_number_id=os.environ.get("SENDER_PHONE_NUMBER_ID", "1030239273516528"),
        whatsapp_provider=os.environ.get("WHATSAPP_PROVIDER", "meta"),
        whatsapp_api_key=os.environ.get("WHATSAPP_API_KEY", ""),
        litellm_base_url=os.environ.get("LITELLM_BASE_URL", ""),
        litellm_api_key=os.environ.get("LITELLM_API_KEY", "sk-anything"),
        llm_model=os.environ.get("LLM_MODEL", "hermes"),
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
        changes["litellm_base_url"] = base_url
    if api_key:
        changes["litellm_api_key"] = api_key
    if model:
        changes.update(llm_model=model)
    return replace(s, **changes) if changes else s
