"""Run configuration. Run-level constants mirror the n8n 'Config — Globals (Replies)'
node; secrets come from env. Reads .env in the package root (same convention as the
other agents)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
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

UNSURE_REPLY = (
    "Dear {company},<br><br>"
    "Thank you for getting back to us. We have carefully gone through your concerns and "
    "are currently checking with our operations team to provide you with a complete answer "
    "as soon as possible.<br><br>"
    "We will follow up with you very shortly.<br><br>"
    "Best regards,<br>Evertrust GmbH"
)


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
    manager_whatsapp_number: str = "84333634500"
    sender_phone_number_id: str = "1030239273516528"
    whatsapp_provider: str = "meta"
    whatsapp_api_key: str = ""
    llm_base_url: str = ""
    llm_api_key: str = "sk-anything"
    llm_model: str = "deepseek"
    google_client_secret_file: str = str(PACKAGE_ROOT / "client_secret.json")
    gmail_token_dir: str = str(PACKAGE_ROOT / "tokens")
    sales_calendar_id: str = "info@evertrust-germany.de"
    sender_addresses: dict = field(default_factory=lambda: {
        "info": "info@evertrust-germany.de",
        "hanna": "hanna@evertrust-germany.de",
    })
    # slot proposal window (verbatim from 'Code — Propose 2 Slots')
    slot_days_ahead: int = 14
    slot_start_hour: int = 9
    slot_end_hour: int = 17
    slot_minutes: int = 30
    slot_count: int = 2
    report_dir: str = str(PACKAGE_ROOT / "runs")


def load_settings() -> Settings:
    _load_dotenv()
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set. Put it in glock/.env or the environment.")
    return Settings(
        database_url=database_url,
        manager_whatsapp_number=os.environ.get("MANAGER_WHATSAPP_NUMBER", "84333634500"),
        sender_phone_number_id=os.environ.get("SENDER_PHONE_NUMBER_ID", "1030239273516528"),
        whatsapp_provider=os.environ.get("WHATSAPP_PROVIDER", "meta"),
        whatsapp_api_key=os.environ.get("WHATSAPP_API_KEY", ""),
        llm_base_url=os.environ.get("LLM_BASE_URL", ""),
        llm_api_key=os.environ.get("LLM_API_KEY", "sk-anything"),
        llm_model=os.environ.get("LLM_MODEL", "deepseek"),
        sales_calendar_id=os.environ.get("SALES_CALENDAR_ID", "info@evertrust-germany.de"),
    )
