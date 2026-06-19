from typing import Any
import httpx
from erp_agents.settings import settings

# Defining the methods possible for interaction with erp backend
class ErpClient:
    def __init__(self) -> None:
        self.base_url = settings.erp_api_url.rstrip("/")
        self.token = settings.erp_agent_token

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["x-agent-token"] = self.token
        return headers
    
    def get(self, path:str) -> dict[str, Any] | list[Any]:
        response = httpx.get(
            f"{self.base_url}{path}",
            headers=self._headers(),
            timeout=30,
        )
        response.raise_for_status()
        return response.json() # Parse response to json
    
    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = httpx.post(
            f"{self.base_url}{path}",
            headers = self._headers(),
            json = payload,
            timeout = 60,
        )
        response.raise_for_status()
        return response.json()
    
    def patch(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = httpx.patch(
            f"{self.base_url}{path}",
            headers = self._headers(),
            json = payload,
            timeout = 60
        )
        response.raise_for_status()
        return response.json()
    
    # Getting an aim result:
    def get_aim(self, aim_id: str) -> dict[str, Any]:
        return self.get(f"/growth/reach/aims/{aim_id}") # Get a specific aim data
    
    # Add new leads for aim:
    def post_leads_for_aim(self, aim_id: str, leads: list):
        self.post(f"/growth/reach/aims/{aim_id}/leads/bulk", {"leads": {leads}} ),
        
    # Saving a new draft:
    def save_reply_draft(self, reply_id: str, *, subject: str, body: str) -> dict[str, Any]:
        return self.patch(
            f"/growth/engage/replies/{reply_id}/draft",
            {
                "subject": subject,
                "body": body,
            }    
        )