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
    data = client.post("/satellite/run", json={"campaignId": "c1", "live": False, "useLlm": False}).json()

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
    data = client.post("/satellite/run", json={"campaignId": "c1", "live": True, "useLlm": False}).json()

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
    data = client.post("/satellite/run", json={"campaignId": "c1", "useLlm": False}).json()

    assert data["status"] == "ok"
    assert data["nicheFallback"] is True
    assert data["nicheTargets"] == 0
    assert fake.niche_triggers == ["c1"]      # analytics still triggered, just non-blocking
    assert data["leadsFound"] == 2            # offline path builds from the niche-as-target
    assert fake.bulk == []                    # dry run still writes nothing


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
