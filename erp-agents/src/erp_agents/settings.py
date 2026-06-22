from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The shared, central agents .env lives at the erp-agents repo root (gitignored;
# the real file lives on the Mac mini). Resolve it ABSOLUTELY so the monolith reads
# the SAME file every standalone agent reads (their settings.py do the equivalent
# PACKAGE_ROOT.parent.parent / ".env"), instead of only a process-CWD ".env".
#   src/erp_agents/settings.py -> parents[0]=erp_agents, [1]=src, [2]=erp-agents
_CENTRAL_ENV = Path(__file__).resolve().parents[2] / ".env"


# Central storage for configuration. Aliases let one Settings read both the spec names
# and the real names already present in erp-agents/.env (ERP_BASE_URL, LLM_BASE_URL, ...).
class Settings(BaseSettings):
    # ---- runtime ----
    agent_mode: str = "dry_run"
    agent_port: int = 8001
    log_level: str = "info"

    # ---- ERP backend (machine API) ----
    erp_api_url: str = Field(
        default="http://localhost:3001",
        validation_alias=AliasChoices("ERP_API_URL", "ERP_BASE_URL"),
    )
    erp_agent_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("ERP_AGENT_TOKEN", "ARSENAL_TOKEN"),
    )

    # ---- LLM: local Hermes via the LiteLLM gateway (OpenAI-compatible /v1) ----
    llm_provider: str = "hermes"
    llm_base_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("LLM_BASE_URL", "LITELLM_BASE_URL"),
    )
    llm_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("LLM_API_KEY", "LITELLM_API_KEY"),
    )
    llm_model: str = Field(
        default="hermes",
        validation_alias=AliasChoices("LLM_MODEL", "OPENAI_MODEL"),
    )

    # ---- Google (Gmail / Calendar / Docs) ----
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_refresh_token: str | None = None
    gmail_user_id: str = "me"
    google_calendar_id: str = Field(
        default="primary",
        validation_alias=AliasChoices("GOOGLE_CALENDAR_ID", "SALES_CALENDAR_ID"),
    )
    google_docs_parent_folder_id: str | None = None

    # ---- WhatsApp Cloud API ----
    whatsapp_api_version: str = "v23.0"
    whatsapp_phone_number_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("WHATSAPP_PHONE_NUMBER_ID", "SENDER_PHONE_NUMBER_ID"),
    )
    whatsapp_access_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_API_KEY"),
    )

    # ---- Read AI ----
    read_ai_api_key: str | None = None
    read_ai_base_url: str | None = None

    # ---- Search ----
    search_provider: str = "serper"
    search_api_key: str | None = None

    model_config = SettingsConfigDict(
        # Read the central erp-agents/.env (absolute) first, then a process-CWD .env
        # as a fallback for laptop dev. Real OS env vars still win over both.
        env_file=(str(_CENTRAL_ENV), ".env"),
        env_file_encoding="utf-8",
        populate_by_name=True,
        extra="ignore",
    )


settings = Settings()
