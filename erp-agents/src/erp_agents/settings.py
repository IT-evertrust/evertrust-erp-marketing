from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    # "auto" picks the best available at runtime: SearXNG if SEARXNG_URL is set,
    # else keyless DuckDuckGo, else the deterministic offline generator. Force a
    # specific one with "searxng" | "duckduckgo" | "serper".
    search_provider: str = "auto"
    search_api_key: str | None = None  # only needed for serper
    searxng_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SEARXNG_URL", "SEARX_URL"),
    )
    search_results_per_query: int = 10

    # ---- Lead Satellite scraping ----
    scrape_max_sites: int = 40  # cap sites fetched per run (politeness + speed)
    scrape_concurrency: int = 8  # parallel fetches (I/O-bound; safe to be high)
    scrape_timeout: float = 10.0  # per-request seconds
    scrape_user_agent: str = (
        "EvertrustLeadBot/1.0 (+https://evertrust-germany.de; B2B prospecting)"
    )
    verify_email_mx: bool = True  # MX check via DNS-over-HTTPS before keeping an email
    lead_min_confidence: float = 0.35  # drop leads the qualifier scores below this

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        populate_by_name=True,
        extra="ignore",
    )


settings = Settings()
