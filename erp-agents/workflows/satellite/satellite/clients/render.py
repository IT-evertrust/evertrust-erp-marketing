"""Headless-browser HTML rendering for JS-rendered pages — GENERIC, niche/country-agnostic.

Most company sites are server-rendered and the plain HttpFetcher reads them fine. But some HUB
pages — industry-association member directories, wpDataTables widgets, JS "Anbieter/Mitglieder"
lists — build their company list client-side, so the raw HTML exposes no member links. This renders
such a page in a real headless Chromium and returns the post-JavaScript DOM, so the generic hub
miner (domain/hubs.py) can read the members. It hardcodes nothing about any site, niche or country.

Used ONLY as a BOUNDED fallback for hub pages (rendering is ~1-3s/page), never for the whole crawl.

Playwright is an OPTIONAL dependency: if it (or its Chromium) isn't installed, render() returns ''
and the caller falls back to the static HTML — nothing crashes.
"""
from __future__ import annotations


class PlaywrightRenderer:
    """Lazy, reusable headless-Chromium renderer. One browser is launched on first use and reused
    across calls (cheap per-page); call close() when done. Availability is probed once: if Playwright
    or Chromium is missing, the renderer silently degrades to a no-op (render() -> '')."""

    def __init__(self, *, timeout_ms: int = 15000, settle_ms: int = 1500) -> None:
        self._timeout = timeout_ms
        self._settle = settle_ms
        self._pw = None
        self._browser = None
        self._ok: bool | None = None     # None=untried, True/False=availability probed

    def available(self) -> bool:
        if self._ok is not None:
            return self._ok
        try:
            from playwright.sync_api import sync_playwright
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=True)
            self._ok = True
        except Exception:
            self._ok = False
        return self._ok

    def render(self, url: str) -> str:
        """Return the fully-rendered HTML of `url` (post-JS), or '' on any failure / unavailability."""
        if not url or not self.available():
            return ""
        page = None
        try:
            page = self._browser.new_page(user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
            page.goto(url, timeout=self._timeout, wait_until="domcontentloaded")
            # Let XHR/fetch-driven tables (wpDataTables etc.) populate before reading the DOM.
            try:
                page.wait_for_load_state("networkidle", timeout=self._timeout)
            except Exception:
                pass
            page.wait_for_timeout(self._settle)
            return page.content() or ""
        except Exception:
            return ""
        finally:
            if page is not None:
                try:
                    page.close()
                except Exception:
                    pass

    def close(self) -> None:
        for obj, meth in ((self._browser, "close"), (self._pw, "stop")):
            try:
                if obj is not None:
                    getattr(obj, meth)()
            except Exception:
                pass
        self._browser = self._pw = None
