"""Search + URL-fetch gateways for Satellite, behind Protocols so tests inject fakes.

Discovery is keyless by default: a SearXNG instance if SEARXNG_URL is set, otherwise
DuckDuckGo's HTML endpoint (no API key). The Cloudflare-decode step fetches company pages.
Real impls use httpx; offline impls return canned data for tests.
"""
from __future__ import annotations

import random
import re
import time
from typing import Protocol
from urllib.parse import unquote

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


class SearchGateway(Protocol):
    def query(self, q: str) -> list[dict]: ...  # [{title, url, content}]


class UrlFetcher(Protocol):
    def get(self, url: str) -> str: ...  # html text ('' on failure)


class SearxngClient:
    def __init__(self, base_url: str, api_key: str = "", timeout: float = 30.0,
                 engines: str = "") -> None:
        import httpx

        self._base = base_url.rstrip("/")
        # Pin the SearXNG engines for every query. Many instances DISABLE strong web engines
        # (e.g. google) by default and leave a noisy mix that returns off-topic junk; naming the
        # engines explicitly enables a disabled one for the request and stops weak engines from
        # dominating. Comma-separated SearXNG engine names; empty = use the instance default.
        self._engines = (engines or "").strip()
        # The searxng-auth Caddy proxy gates requests on this header (= SEARXNG_API_KEY).
        headers = {"X-Search-Key": api_key} if api_key else {}
        self._http = httpx.Client(timeout=timeout, headers=headers)

    def close(self) -> None:
        self._http.close()

    def query(self, q: str, pageno: int = 1, language: str = "") -> list[dict]:
        if not self._base:
            return []
        params = {"q": q, "format": "json"}
        if pageno and pageno > 1:
            params["pageno"] = pageno
        if language:
            params["language"] = language
        if self._engines:
            params["engines"] = self._engines
        r = self._http.get(self._base + "/search", params=params)
        r.raise_for_status()
        data = r.json()
        results = data.get("results", []) if isinstance(data, dict) else []
        return [{"title": x.get("title", ""), "url": x.get("url", ""), "content": x.get("content", "")}
                for x in results]


_DDG_RESULT = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_DDG_SNIP = re.compile(r'class="result__snippet"[^>]*>(.*?)</a>', re.S)
_DDG_TAGS = re.compile(r"<[^>]+>")


def _ddg_text(s: str) -> str:
    return re.sub(r"\s+", " ", _DDG_TAGS.sub("", s or "")).strip()


class DuckDuckGoSearch:
    """Keyless web search via DuckDuckGo's HTML endpoint. No API key; returns the same
    [{title,url,content}] shape as SearXNG. Parsed with regex (no bs4)."""

    ENDPOINT = "https://html.duckduckgo.com/html/"

    def __init__(self, pages: int = 1, timeout: float = 12.0, retries: int = 1,
                 backoff: float = 2.0) -> None:
        import httpx

        self._pages = max(1, pages)
        self._retries = max(0, retries)
        self._backoff = backoff
        self._http = httpx.Client(
            timeout=timeout, follow_redirects=True,
            headers={"User-Agent": _UA, "Accept": "text/html", "Accept-Language": "en,de,pl"},
        )

    def close(self) -> None:
        self._http.close()

    def _query_once(self, q: str) -> list[dict]:
        out: list[dict] = []
        for page in range(self._pages):
            data = {"q": q}
            if page:
                data["s"] = str(page * 30)
            try:
                r = self._http.post(self.ENDPOINT, data=data)
                r.raise_for_status()
                html = r.text
            except Exception:
                break
            results = _DDG_RESULT.findall(html)
            snips = _DDG_SNIP.findall(html)
            for i, (url, title) in enumerate(results):
                if url.startswith("//duckduckgo.com/l/") or "uddg=" in url:
                    m = re.search(r"uddg=([^&]+)", url)
                    if m:
                        url = unquote(m.group(1))
                out.append({"title": _ddg_text(title), "url": url,
                            "content": _ddg_text(snips[i]) if i < len(snips) else ""})
            if not results:
                break
        return out

    def query(self, q: str) -> list[dict]:
        # DuckDuckGo rate-limits bursts (returns an empty page). Retry with jittered
        # backoff — the throttle clears in a few seconds — before giving up.
        for attempt in range(self._retries + 1):
            out = self._query_once(q)
            if out:
                return out
            if attempt < self._retries:
                time.sleep(self._backoff * (attempt + 1) + random.uniform(0.0, 1.0))
        return []


class WebSearch:
    """Composite discovery gateway, SearXNG-FIRST: SearXNG when SEARXNG_URL is set (and it returns
    hits). DuckDuckGo is an OPTIONAL fallback — used only when `enable_ddg` is set, OR when no
    SearXNG is configured at all (so the gateway always has a keyless engine). This stops a weak DDG
    page from quietly displacing SearXNG results. Either way the caller gets [{title,url,content}]."""

    def __init__(self, searxng_url: str = "", searxng_api_key: str = "", pages: int = 1,
                 enable_ddg: bool = False, engines: str = "") -> None:
        self._searx = SearxngClient(searxng_url, searxng_api_key, engines=engines) if searxng_url else None
        # Build DDG only when explicitly enabled, or when there's no SearXNG to fall back from.
        self._ddg = DuckDuckGoSearch(pages=pages) if (enable_ddg or self._searx is None) else None

    def query(self, q: str) -> list[dict]:
        if self._searx is not None:
            try:
                hits = self._searx.query(q)
                if hits:
                    return hits
            except Exception:
                pass
        return self._ddg.query(q) if self._ddg is not None else []

    def query_paged(self, q: str, pages: int = 1, language: str = "") -> list[dict]:
        """Aggregate up to `pages` result pages for a query (SearXNG pageno; DDG falls back to
        its own paging). Deduped by URL. `language` biases SearXNG to the local market."""
        out, seen = [], set()
        if self._searx is not None:
            try:
                for p in range(1, max(1, pages) + 1):
                    hits = self._searx.query(q, pageno=p, language=language)
                    if not hits:
                        break
                    for h in hits:
                        u = h.get("url", "")
                        if u and u not in seen:
                            seen.add(u)
                            out.append(h)
                if out:
                    return out
            except Exception:
                pass
        # DuckDuckGo fallback (its own multi-page handling lives in DuckDuckGoSearch.pages).
        if self._ddg is None:
            return out
        for h in self._ddg.query(q):
            u = h.get("url", "")
            if u and u not in seen:
                seen.add(u)
                out.append(h)
        return out

    def close(self) -> None:
        for c in (self._searx, self._ddg):
            try:
                if c is not None:
                    c.close()
            except Exception:
                pass


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
    """Deterministic search for tests / --no-llm. `offline` marks it so the pipeline uses
    the canned placeholder path instead of reporting a (real) search backend as unavailable."""

    offline = True

    def query(self, q: str) -> list[dict]:
        return []


class OfflineFetcher:
    def get(self, url: str) -> str:
        return ""
