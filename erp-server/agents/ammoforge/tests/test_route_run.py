"""Route -> AmmoForge -> output. When the ERP route calls AmmoForge, it forges templates and
returns the result. FastAPI TestClient + fake ERP gateway: no live ERP, no network, no LLM.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from ammoforge import server
from ammoforge.domain.models import CampaignConfig


class FakeErp:
    def __init__(self) -> None:
        self.posted: list = []
        self.notifications: list = []

    def fetch_campaign_config(self, campaign_id):
        return CampaignConfig(
            campaign_id=campaign_id, name="POLAND CONTAINER 2026",
            niche="LED Container Rental", country="Poland", region="Anywhere",
            project="POLAND CONTAINER 2026", overrides={},
        )

    def post_templates(self, campaign_id, templates):
        self.posted.append((campaign_id, templates))
        return {"ok": True}

    def post_notification(self, ntype, title, body, campaign_id=None, link=None):
        self.notifications.append(ntype)
        return {"ok": True}


@pytest.fixture
def fake_erp():
    fake = FakeErp()
    server.app.dependency_overrides[server.get_erp] = lambda: fake
    yield fake
    server.app.dependency_overrides.clear()


def test_route_forge_dry(fake_erp):
    client = TestClient(server.app)
    data = client.post("/ammoforge/run", json={"campaignId": "c1", "live": False, "useLlm": False}).json()

    assert data["status"] == "ok"
    assert data["mode"] == "dry"
    # offline forge produced the tagged 3-block sequence + newsBrief
    cold = data["templates"]["coldEmail"]
    assert "[COLD]" in cold and "[FOLLOWUP]" in cold and "[FINALPUSH]" in cold
    assert "{{Company Name}}" in cold
    assert data["templates"]["newsBrief"]
    # dry-run: nothing written to the ERP
    assert data["posted"] is False
    assert fake_erp.posted == [] and fake_erp.notifications == []


def test_route_forge_live_writes(fake_erp):
    client = TestClient(server.app)
    data = client.post("/ammoforge/run", json={"campaignId": "c1", "live": True, "useLlm": False}).json()

    assert data["status"] == "ok" and data["mode"] == "live"
    assert data["posted"] is True and data["notified"] is True
    assert len(fake_erp.posted) == 1
    cid, templates = fake_erp.posted[0]
    assert cid == "c1" and "coldEmail" in templates and "newsBrief" in templates
    assert fake_erp.notifications == ["TEMPLATES_READY"]


def test_missing_campaign_id_errors(fake_erp):
    client = TestClient(server.app)
    data = client.post("/ammoforge/run", json={"campaignId": "", "useLlm": False}).json()
    assert data["status"] == "error"


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
