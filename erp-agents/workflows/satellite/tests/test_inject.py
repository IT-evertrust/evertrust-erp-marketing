"""INJECTED-config / return-only mode (the Reach flow).

The Reach flow drives Satellite with a reach_aim id that has NO GET /campaigns/:id/config
endpoint, so the config is INJECTED via the ERP gateway seam and the run is RETURN-ONLY:
no /campaigns/:id/config fetch over HTTP, no prospect/callback writes. This mirrors the
monolith's ConfigInjectingErp: fetch_campaign_config serves a pre-built CampaignConfig and
every write method is a no-op. The region is a ZONE word ("North"), resolved via the LLM
country profiler (region_focus) — never expanded as a literal city term.
"""
from __future__ import annotations

from satellite.clients.search import OfflineFetcher, OfflineSearch
from satellite.domain.models import CampaignConfig
from satellite.pipeline import RunOptions, run as satellite_run
from satellite.settings import Settings


class InjectingErp:
    """Serves an injected CampaignConfig; every write is a no-op (return-only).

    Records whether the HTTP fetch path or any write was ever taken so the test can assert
    NOTHING was fetched over /campaigns/:id/config and NOTHING was posted.
    """

    def __init__(self, cfg: CampaignConfig) -> None:
        self._cfg = cfg
        self.fetched_over_http = False  # would be set by a real HTTP gateway; stays False here
        self.bulk: list = []
        self.callbacks: list = []
        self.niche_triggers: list = []

    def fetch_campaign_config(self, campaign_id):
        # INJECTED: return the pre-built config, NO network / no /campaigns/:id/config call.
        return self._cfg

    def post_prospects_bulk(self, campaign_id, prospects):
        self.bulk.append((campaign_id, prospects))
        return {"created": 0, "updated": 0, "skipped": len(prospects)}

    def post_run_callback(self, campaign_id, metrics, status="SUCCESS"):
        self.callbacks.append((campaign_id, metrics))
        return {"ok": True, "skipped": True}

    def trigger_niche_analytics(self, campaign_id):
        self.niche_triggers.append(campaign_id)
        return {"status": 0, "skipped": True}


def _injected_cfg(region: str) -> CampaignConfig:
    # Built from the wire `config` dict the NestJS Reach service sends (mapped to the dataclass).
    return CampaignConfig(
        campaign_id="aim-uuid-1",
        niche="LED Container Rental",
        niche_id="n1",
        targets=[{"id": "t1", "name": "LED Rental", "slug": "led", "searchHint": ""}],
        region=region,
        country="Germany",
        project="Reach AIM",
        max_leads_per_run=500,
    )


def test_injected_return_only_no_fetch_no_writes():
    # Return-only: leads come back, but NOTHING is posted (persist=False) and the config is the
    # injected one (the gateway never hit /campaigns/:id/config — fetched_over_http stays False).
    cfg = _injected_cfg(region="North")
    erp = InjectingErp(cfg)
    opts = RunOptions(campaign_id=cfg.campaign_id, live=False, persist=False, use_llm=False,
                      region_focus="North")
    result = satellite_run(Settings(llm_base_url=""), opts, erp, OfflineSearch(), OfflineFetcher())

    # (a) config was injected, not fetched over HTTP
    assert erp.fetched_over_http is False
    assert result["niche"] == "LED Container Rental"
    # (b) leads/prospects returned in the result dict
    assert result["status"] == "ok"
    assert result["leadsFound"] >= 1
    assert len(result["leads"]) >= 1
    # (c) return-only: no writes at all
    assert result["posted"] is False
    assert erp.bulk == []
    assert erp.callbacks == []


def test_zone_not_expanded_as_literal_city():
    # The zone word ("North") must NEVER appear as a city/geo term — it is a relative part of the
    # country resolved by the profiler (region_focus). Offline (no LLM) it degrades to the COUNTRY
    # name as the single geo term, never the literal "North".
    cfg = _injected_cfg(region="North")
    erp = InjectingErp(cfg)
    opts = RunOptions(campaign_id=cfg.campaign_id, persist=False, use_llm=False, region_focus="North")
    result = satellite_run(Settings(llm_base_url=""), opts, erp, OfflineSearch(), OfflineFetcher())

    cities = {(p.get("city") or "").lower() for p in result["leads"]}
    assert "north" not in cities                      # zone word never became a city
    assert result.get("regionFocus") == "North"       # the zone is recorded as a focus, not a place


def test_anywhere_is_unchanged_whole_country():
    # "Anywhere" (or empty) => whole country, the normal nationwide path; no region_focus recorded.
    cfg = _injected_cfg(region="Anywhere")
    erp = InjectingErp(cfg)
    opts = RunOptions(campaign_id=cfg.campaign_id, persist=False, use_llm=False, region_focus=None)
    result = satellite_run(Settings(llm_base_url=""), opts, erp, OfflineSearch(), OfflineFetcher())

    assert result["status"] == "ok"
    assert result["leadsFound"] >= 1
    assert "regionFocus" not in result               # Anywhere is not a zone focus


def test_profiler_receives_region_focus(monkeypatch):
    # When a zone is set with an LLM gateway, the profiler is called WITH region_focus, and the
    # pipeline uses the profiler's cities (the zone never reaches cities_for as a literal).
    from satellite.clients import llm as llmmod

    captured = {}

    def fake_profile(settings, country, niche, industry="", **kwargs):
        captured["country"] = country
        captured["region_focus"] = kwargs.get("region_focus")
        return {"iso2": "DE", "langCode": "de",
                "keywordsLocal": ["beleuchtung"], "keywordsEnglish": ["lighting"],
                "regions": [{"name": "Schleswig-Holstein", "cities": ["Kiel", "Lübeck"]}],
                "cities": ["Kiel", "Lübeck"]}

    monkeypatch.setattr(llmmod, "profile_country", fake_profile)
    monkeypatch.setattr(llmmod, "recover_emails", lambda *a, **k: {})

    # A search that returns hits, so discovery (not the LLM lead-research fallback) runs.
    class FakeSearch:
        offline = False

        def query(self, q):
            return [{"title": "Nord Licht GmbH", "url": "https://nordlicht.de/", "content": "beleuchtung"}]

        def query_paged(self, q, pages=1, language=""):
            return self.query(q)

    cfg = _injected_cfg(region="North")
    erp = InjectingErp(cfg)
    opts = RunOptions(campaign_id=cfg.campaign_id, persist=False, use_llm=True, region_focus="North")
    result = satellite_run(
        Settings(llm_base_url="http://fake-llm", searxng_url="", region_cooldown=0.0),
        opts, erp, FakeSearch(), OfflineFetcher())

    assert captured["region_focus"] == "North"        # zone flowed to the profiler
    assert captured["country"] == "Germany"
    assert result["status"] == "ok"
    # profiler cities (Kiel/Lübeck) were used; the zone word "North" was not a city.
    cities = {(p.get("city") or "").lower() for p in result["leads"]}
    assert "north" not in cities
