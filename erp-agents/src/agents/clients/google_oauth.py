from google.oauth2.credentials import Credentials
from erp_agents.settings import settings

# Building credential for each user
def build_google_credentials(scopes: list[str]) -> Credentials:
    # Error handling: 
    if not settings.google_client_id:
        raise ValueError("GOOGLE_CLIENT_ID is missing")
    
    if not settings.google_client_secret:
        raise ValueError("GOOGLE_CLIENT_SECRET is missing")
    
    if not settings.google_refresh_token:
        raise ValueError("GOOGLE_REFRESH_TOKEN is missing")
    
    # Returning credential per user
    return Credentials(
        token = None,
        refresh_token = settings.google_refresh_token,
        token_uri = "https://oauth2.googleapis.com/token",
        client_id = settings.google_client_id,
        client_secret = settings.google_client_secret,
        scopes = scopes,
    )