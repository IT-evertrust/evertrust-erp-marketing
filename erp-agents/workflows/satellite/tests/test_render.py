"""Tests for the headless renderer's safe-degradation contract (no browser launched here)."""
from satellite.clients.render import PlaywrightRenderer


def test_render_empty_url_short_circuits():
    # `not url` is checked before availability, so no Chromium is launched.
    assert PlaywrightRenderer().render("") == ""


def test_render_returns_empty_when_unavailable(monkeypatch):
    r = PlaywrightRenderer()
    monkeypatch.setattr(r, "available", lambda: False)   # simulate playwright/chromium missing
    assert r.render("https://example.com/anything") == ""
    r.close()


def test_close_is_idempotent_and_safe_before_use():
    r = PlaywrightRenderer()
    r.close()   # never launched -> must not raise
    r.close()
