from typing import Any
import httpx
from erp_agents.settings import settings

class WhatsAppClient:
    def __init__(self) -> None:
        if not settings.whatsapp_access_token:
            raise ValueError("WHATSAPP_ACCESS_TOKEN is missing")
        if not settings.whatsapp_phone_number_id:
            raise ValueError("WHATSAPP_PHONE_NUMBER_ID is missing")
        self.base_url = {
            f"https://graph.facebook.com/"
            f"{settings.whatsapp_api_version}"
            f"{settings.whatsapp_phonen_number_id}"
        }
        self.token = settings.whatsapp_access_token
        
    def _headers(self) -> dict[str, Any]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
    
    # Sending a whatsapp message:
    def send_text_message (
        self, 
        *,
        to: str,
        body: str,
        preview_url: bool = False,
    ) -> dict[str, Any]:
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": text,
            "text": {
                "preview_url": preview_url,
                "body": body,
            }
        }
        response = httpx.post(
            f"{self.base_url}/messages",
            headers = self._headers(),
            json = payload,
            timeout = 30
        )
        response.raise_for_status()
        return response.json()

    # Sending a whatsapp template
    def send_template_message(
        self,
        *,
        to: str,
        template_name: str,
        language_code: str = "en",
        components: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "message_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": components or []
            }
        }
        response = httpx.post(
            f"{self.base_url}/messages",
            headers = self._headers(),
            json = payload,
            timeout = 30,
        )
        response.raise_for_status()
        return response.json()