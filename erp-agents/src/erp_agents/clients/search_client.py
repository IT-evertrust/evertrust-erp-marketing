"""Web search gateway for lead discovery.

Pluggable providers, all normalized to {title, url, snippet}:
  - searxng     self-hosted meta-search (free, high volume) via SEARXNG_URL
  - duckduckgo  keyless HTML endpoint (no key, but rate-limits bursts)
  - serper      Google results via API key (paid, reliable)
  - auto        SearXNG if configured, else DuckDuckGo, else None (caller falls back offline)

Every search() degrades to [] on transport/parse error rather than raising, so the
workflow can fall back to its offline generator and never crash a run.
"""

from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import unquote

import httpx

from erp_agents.settings import settings

_DDG_RESULT = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>',
    re.DOTALL,
)
_DDG_SNIPPET = re.compile(
    r'<a[^>]+class="result__snippet"[^>]*>(?P<snippet>.*?)</a>', re.DOTALL
)
_TAGS = re.compile(r"<[^>]+>")


def _strip(text: str) -> str:
    return html.unescape(_TAGS.sub("", text)).strip()


class SearchClient:
    def __init__(self) -> None:
        self.provider = (settings.search_provider or "auto").lower()
        self.api_key = settings.search_api_key
        self.searxng_url = (settings.searxng_url or "").rstrip("/")

    def resolve_provider(self) -> str | None:
        """The concrete provider 'auto' resolves to, or None if nothing is usable."""
        if self.provider == "auto":
            if self.searxng_url:
                return "searxng"
            return "duckduckgo"  # keyless default
        if self.provider == "serper" and not self.api_key:
            return None
        if self.provider == "searxng" and not self.searxng_url:
            return None
        return self.provider

    def is_available(self) -> bool:
        return self.resolve_provider() is not None

    def search(self, query: str, limit: int | None = None) -> list[dict[str, Any]]:
        limit = limit or settings.search_results_per_query
        provider = self.resolve_provider()
        try:
            if provider == "searxng":
                return self._search_searxng(query, limit)
            if provider == "duckduckgo":
                return self._search_duckduckgo(query, limit)
            if provider == "serper":
                return self._search_serper(query, limit)
        except Exception:
            return []
        return []

    # ---- providers ----
    def _search_searxng(self, query: str, limit: int) -> list[dict[str, Any]]:
        resp = httpx.get(
            f"{self.searxng_url}/search",
            params={"q": query, "format": "json"},
            headers={"User-Agent": settings.scrape_user_agent},
            timeout=20,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        out: list[dict[str, Any]] = []
        for r in results[:limit]:
            url = r.get("url")
            if url:
                out.append(
                    {
                        "title": (r.get("title") or "").strip(),
                        "url": url,
                        "snippet": (r.get("content") or "").strip(),
                    }
                )
        return out

    def _search_duckduckgo(self, query: str, limit: int) -> list[dict[str, Any]]:
        resp = httpx.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers={"User-Agent": settings.scrape_user_agent},
            timeout=20,
            follow_redirects=True,
        )
        resp.raise_for_status()
        body = resp.text
        snippets = [_strip(m.group("snippet")) for m in _DDG_SNIPPET.finditer(body)]
        out: list[dict[str, Any]] = []
        for i, m in enumerate(_DDG_RESULT.finditer(body)):
            if len(out) >= limit:
                break
            url = self._ddg_unwrap(m.group("href"))
            if not url:
                continue
            out.append(
                {
                    "title": _strip(m.group("title")),
                    "url": url,
                    "snippet": snippets[i] if i < len(snippets) else "",
                }
            )
        return out

    @staticmethod
    def _ddg_unwrap(href: str) -> str | None:
        # DDG wraps targets as /l/?uddg=<encoded-url>. Unwrap to the real URL.
        if "uddg=" in href:
            m = re.search(r"uddg=([^&]+)", href)
            if m:
                return unquote(m.group(1))
        if href.startswith("http"):
            return href
        return None

    def _search_serper(self, query: str, limit: int) -> list[dict[str, Any]]:
        resp = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": self.api_key or "", "Content-Type": "application/json"},
            json={"q": query, "num": limit},
            timeout=30,
        )
        resp.raise_for_status()
        organic = resp.json().get("organic", [])
        return [
            {
                "title": (r.get("title") or "").strip(),
                "url": r.get("link"),
                "snippet": (r.get("snippet") or "").strip(),
            }
            for r in organic[:limit]
            if r.get("link")
        ]
