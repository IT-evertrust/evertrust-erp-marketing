"""Search + URL-fetch gateways for Satellite, behind Protocols so tests inject fakes.

The n8n workflow's web_search tool hits a SearXNG instance; the Cloudflare-decode step
fetches company pages. Real impls use httpx; offline impls return canned data for tests.
"""
from __future__ import annotations

from typing import Protocol


class SearchGateway(Protocol):
    def query(self, q: str) -> list[dict]: ...  # [{title, url, content}]


class UrlFetcher(Protocol):
    def get(self, url: str) -> str: ...  # html text ('' on failure)


class SearxngClient:
    def __init__(self, base_url: str, token: str = "", timeout: float = 30.0) -> None:
        import httpx

        self._base = base_url.rstrip("/")
        headers = {"x-arsenal-token": token} if token else {}
        self._http = httpx.Client(timeout=timeout, headers=headers)

    def close(self) -> None:
        self._http.close()

    def query(self, q: str) -> list[dict]:
        if not self._base:
            return []
        r = self._http.get(self._base + "/search", params={"q": q, "format": "json"})
        r.raise_for_status()
        data = r.json()
        results = data.get("results", []) if isinstance(data, dict) else []
        return [{"title": x.get("title", ""), "url": x.get("url", ""), "content": x.get("content", "")}
                for x in results]


class HttpFetcher:
    def __init__(self, timeout: float = 6.0) -> None:
        import httpx

        self._http = httpx.Client(
            timeout=timeout, follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; EvertrustLeadBot/1.0)", "Accept": "text/html"},
        )

    def close(self) -> None:
        self._http.close()

    def get(self, url: str) -> str:
        try:
            r = self._http.get(url)
            return r.text or ""
        except Exception:
            return ""


class OfflineSearch:
    """Deterministic search for tests / --no-llm."""

    def query(self, q: str) -> list[dict]:
        return []


class OfflineFetcher:
    def get(self, url: str) -> str:
        return ""
