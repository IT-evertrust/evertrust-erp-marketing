"""Run configuration for Reply Glock. Reads the central agents .env; talks to the ERP machine API.
Run-level constants mirror the n8n 'Config — Globals (Replies)' node."""
from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
TZ = "Europe/Berlin"

# Gmail discovery query — verbatim from 'Code — Collect Active Labels'.
REPLY_QUERY = (
    "is:unread newer_than:30d subject:Re: "
    "-from:calendar-notification@google.com -from:noreply@google.com "
    "-from:pictory.ai -from:activecampaign.com -from:otter.ai "
    "-from:read.ai -from:e.read.ai"
)

SIGNATURE_IMG = "https://lh3.googleusercontent.com/d/1mNy9SN_iJjuw_ZgbNCwSepeF8YnozyvE"


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
    manager_whatsapp_number: str = "84333634500"
    sender_phone_number_id: str = "1030239273516528"
    whatsapp_provider: str = "meta"
    whatsapp_api_key: str = ""
    llm_base_url: str = ""
    llm_api_key: str = "sk-anything"
    llm_model: str = "hermes"  # n8n REPLY GLOCK (PG) v2 uses hermes
    google_client_secret_file: str = str(PACKAGE_ROOT / "client_secret.json")
    gmail_token_dir: str = str(PACKAGE_ROOT / "tokens")
    sales_calendar_id: str = "info@evertrust-germany.de"
    sender_addresses: dict = field(default_factory=lambda: {
        "info": "info@evertrust-germany.de",
        "hanna": "hanna@evertrust-germany.de",
    })
    SIGNATURE_IMG: str = SIGNATURE_IMG
    slot_days_ahead: int = 14
    slot_start_hour: int = 9
    slot_end_hour: int = 17
    slot_minutes: int = 30
    slot_count: int = 2
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
        llm_base_url=os.environ.get("LLM_BASE_URL", os.environ.get("LITELLM_BASE_URL", "")),
        llm_api_key=os.environ.get("LLM_API_KEY", os.environ.get("LITELLM_API_KEY", "sk-anything")),
        llm_model=os.environ.get("LLM_MODEL", "hermes"),
        sales_calendar_id=os.environ.get("SALES_CALENDAR_ID", "info@evertrust-germany.de"),
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
        changes.update(llm_model=model)
    return replace(s, **changes) if changes else s
