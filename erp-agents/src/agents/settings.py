from pydantic_settings import BaseSettings, SettingsConfigDict

# Central storage for configuration:
class Settings(BaseSettings):
    agent_mode: str = "dry_run"
    agent_port: int = 80001
    log_level: str = "info"
    
    erp_api_url: str  = "http://localhost:3001"
    erp_agent_token: str | None = None
    
    llm_provider: str = "qwen3.5"
    llm_api_key: str | None = None
    llm_model: str | None = None
    
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_refresh_token: str | None = None
    
    gmail_user_id: str = "me"
    google_calendar_id: str = "primary"
    
    whatsapp_api_version: str = "v23.0"
    whatsapp_phone_number_id: str | None = None
    whatsapp_access_token: str | None = None
    
    read_ai_api_key: str | None = None
    read_ai_base_url: str | None = None
    
    search_provider: str = "serper"
    search_api_key: str | None = None
    
    model_config = SettingsConfigDict(
        env_file = '.env',
        env_file_encoding = "utf-8"
    )

settings = Settings()    
    
    