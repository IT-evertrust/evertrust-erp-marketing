from typing import Any

import httpx

from erp_agents.settings import settings


class SearchClient:
    def __init__(self) -> None:
        self.provider = settings.search_provider
        self.api_key = settings.search_api_key

    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        if self.provider == "serper":
            return self._search_serper(query, limit)

        raise ValueError(f"Unsupported search provider: {self.provider}")

    def _search_serper(self, query: str, limit: int) -> list[dict[str, Any]]:
        if not self.api_key:
            raise ValueError("SEARCH_API_KEY is missing")

        response = httpx.post(
            "https://google.serper.dev/search",
            headers={
                "X-API-KEY": self.api_key,
                "Content-Type": "application/json",
            },
            json={
                "q": query,
                "num": limit,
            },
            timeout=30,
        )
        response.raise_for_status()

        data = response.json()
        return data.get("organic", [])