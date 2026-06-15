from __future__ import annotations

import os
from dataclasses import dataclass
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
    manager_whatsapp_number: str = "84333634500"
    sender_phone_number_id: str = "1030239273516528"
    whatsapp_provider: str = "meta"
    whatsapp_api_key: str = ""
    report_dir: str = str(PACKAGE_ROOT / "runs")


def load_settings() -> Settings:
    _load_dotenv()
    db = os.environ.get("DATABASE_URL", "")
    if not db:
        raise SystemExit("DATABASE_URL is not set. Put it in sleeper/.env or the environment.")
    return Settings(
        database_url=db,
        manager_whatsapp_number=os.environ.get("MANAGER_WHATSAPP_NUMBER", "84333634500"),
        sender_phone_number_id=os.environ.get("SENDER_PHONE_NUMBER_ID", "1030239273516528"),
        whatsapp_provider=os.environ.get("WHATSAPP_PROVIDER", "meta"),
        whatsapp_api_key=os.environ.get("WHATSAPP_API_KEY", ""),
    )
