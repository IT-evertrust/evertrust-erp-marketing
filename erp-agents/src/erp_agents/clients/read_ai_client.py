from typing import Any

import httpx

from erp_agents.settings import settings


# Pulls meeting transcripts/analysis (Read AI). Side-effect client only.
class ReadAiClient:
    def __init__(self) -> None:
        if not settings.read_ai_base_url:
            raise ValueError("READ_AI_BASE_URL is missing")
        if not settings.read_ai_api_key:
            raise ValueError("READ_AI_API_KEY is missing")
        self.base_url = settings.read_ai_base_url.rstrip("/")
        self.api_key = settings.read_ai_api_key

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def get_meeting_analysis(self, meeting_id: str) -> dict[str, Any]:
        response = httpx.get(
            f"{self.base_url}/meetings/{meeting_id}", headers=self._headers(), timeout=30
        )
        response.raise_for_status()
        return response.json()

    def list_recent_meetings(self, limit: int = 25) -> list[dict[str, Any]]:
        response = httpx.get(
            f"{self.base_url}/meetings", headers=self._headers(), params={"limit": limit}, timeout=30
        )
        response.raise_for_status()
        data = response.json()
        if isinstance(data, list):
            return data
        return data.get("items", [])
