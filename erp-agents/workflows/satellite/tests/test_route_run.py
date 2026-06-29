"""Route -> Satellite -> output. FastAPI TestClient + fake ERP/search/fetcher: no live ERP,
no network, no LLM (offline research). Mirrors LEAD SATELLITE (PG) behaviour.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from satellite import server
from satellite.clients.search import OfflineFetcher, OfflineSearch
from satellite.domain.models import CampaignConfig


class FakeErp:
    def __init__(self, targets=None) -> None:
        self._targets = targets if targets is not None else [{"id": "t1", "name": "LED Rental", "slug": "led"}]
        self.bulk: list = []
        self.callbacks: list = []
        self.niche_triggers: list = []

    def fetch_campaign_config(self, campaign_id):
        return CampaignConfig(
            campaign_id=campaign_id, niche="LED Container Rental", niche_id="n1",
            targets=self._targets, region="Berlin, Munich", country="Germany",
            project="POLAND CONTAINER 2026", max_leads_per_run=500,
        )

    def post_prospects_bulk(self, campaign_id, prospects):
        self.bulk.append((campaign_id, prospects))
        return {"created": len(prospects), "updated": 0}

    def post_run_callback(self, campaign_id, metrics, status="SUCCESS"):
        self.callbacks.append((campaign_id, metrics))
        return {"ok": True}

    def trigger_niche_analytics(self, campaign_id):
        self.niche_triggers.append(campaign_id)
        return {"status": 200}


def _wire(fake):
    server.app.dependency_overrides[server.get_erp] = lambda: fake
    server.app.dependency_overrides[server.get_search] = lambda: OfflineSearch()
    server.app.dependency_overrides[server.get_fetcher] = lambda: OfflineFetcher()


@pytest.fixture(autouse=True)
def cleanup():
    yield
    server.app.dependency_overrides.clear()


def test_route_satellite_dry():
    fake = FakeErp()
    _wire(fake)
    client = TestClient(server.app)
    data = client.post("/satellite/run", json={"campaignId": "c1", "live": False, "useLlm": False, "wait": True}).json()

    assert data["status"] == "ok" and data["mode"] == "dry"
    assert data["segmentsPlanned"] == 8          # 1 target x 2 cities x 4 foci
    assert data["leadsFound"] == 2               # 4 foci/city collapse by domain -> 1 per city
    assert data["prospects"] == 2 and data["verified"] == 2
    assert data["posted"] is False
    assert fake.bulk == [] and fake.callbacks == []


def test_route_satellite_live_writes():
    fake = FakeErp()
    _wire(fake)
    client = TestClient(server.app)
    data = client.post("/satellite/run", json={"campaignId": "c1", "live": True, "useLlm": False, "wait": True}).json()

    assert data["status"] == "ok" and data["posted"] is True
    assert len(fake.bulk) == 1
    cid, prospects = fake.bulk[0]
    assert cid == "c1" and len(prospects) == 2
    assert fake.callbacks == [("c1", {"prospectsUpserted": 2, "segmentsPlanned": 8})]


def test_no_targets_falls_back_to_niche():
    # No curated targets -> no longer a hard gate: scrape using the niche name itself,
    # and still kick off NICHE ANALYTICS (best-effort) for future enrichment.
    fake = FakeErp(targets=[])
    _wire(fake)
    client = TestClient(server.app)
    data = client.post("/satellite/run", json={"campaignId": "c1", "useLlm": False, "wait": True}).json()

    assert data["status"] == "ok"
    assert data["nicheFallback"] is True
    assert data["nicheTargets"] == 0
    assert fake.niche_triggers == ["c1"]      # analytics still triggered, just non-blocking
    assert data["leadsFound"] == 2            # offline path builds from the niche-as-target
    assert fake.bulk == []                    # dry run still writes nothing


def test_nationwide_loops_all_regions(monkeypatch):
    # "Anywhere" for ANY country -> loop EVERY region the profiler returns (here 2), bilingually.
    from satellite.clients import llm as llmmod
    from satellite.settings import Settings

    monkeypatch.setattr(llmmod, "profile_country", lambda *a, **k: {
        "iso2": "BG", "langCode": "bg",
        "keywordsLocal": ["киберсигурност"], "keywordsEnglish": ["cybersecurity"],
        "regions": [{"name": "Sofia", "cities": ["София"]}, {"name": "Plovdiv", "cities": ["Пловдив"]}],
        "cities": ["София", "Пловдив"],
    })
    monkeypatch.setattr(llmmod, "recover_emails", lambda *a, **k: {})

    class FakeErpBG:
        def fetch_campaign_config(self, cid):
            return CampaignConfig(campaign_id=cid, niche="Cybersecurity", targets=[],
                                  region="Anywhere", country="Bulgaria", max_leads_per_run=500)

        def post_prospects_bulk(self, *a, **k):
            return {"created": 0, "updated": 0}

        def post_run_callback(self, *a, **k):
            return {}

        def trigger_niche_analytics(self, *a, **k):
            return {}

    class FakeSearch:
        offline = False

        def query(self, q):
            return [{"title": "Кибер ООД", "url": "https://kibersec.bg/", "content": "киберсигурност"}]

        def query_paged(self, q, pages=1, language=""):
            return self.query(q)

    server.app.dependency_overrides[server.get_settings] = lambda: Settings(
        llm_base_url="http://fake-llm", searxng_url="", region_cooldown=0.0, lead_target=10_000,
        max_regions=2)
    server.app.dependency_overrides[server.get_erp] = lambda: FakeErpBG()
    server.app.dependency_overrides[server.get_search] = lambda: FakeSearch()
    server.app.dependency_overrides[server.get_fetcher] = lambda: OfflineFetcher()
    data = TestClient(server.app).post(
        "/satellite/run", json={"campaignId": "bg", "useLlm": True, "wait": True}).json()

    assert data["status"] == "ok"
    # Bulgaria is in the local GeoNames dataset -> real regions drive the nationwide sweep, looped
    # one batch at a time, capped here to max_regions=2 so the count stays deterministic.
    assert data.get("geoSource") == "geonames"
    assert data["regionsScanned"] == 2          # looped 2 regions (per-region batched sweep)
    assert data["leadsFound"] >= 1              # native-named .bg lead kept (bilingual gate + .bg market)


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
