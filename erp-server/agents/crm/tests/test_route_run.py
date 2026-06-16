"""Route -> CRM -> output. FastAPI TestClient + fake ERP: no live ERP, no network.
Mirrors CRM Customer (PG) intake + graduation."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from crm import server


class FakeErp:
    def __init__(self):
        self.hot, self.customers_posted = [], []

    def list_active_campaigns(self):
        return [{"campaignId": "c1", "campaignName": "POLAND", "niche": "LED"}]

    def get_customers(self, limit=1000):
        return [{"email": "existing@cust.de"}]

    def get_prospects(self, campaign_id, limit=500):
        return [
            {"id": "p1", "email": "interested@a.de", "companyName": "Acme", "status": "Interested"},
            {"id": "p2", "email": "meeting@b.de", "companyName": "Beta GmbH", "status": "Meeting Scheduled"},
            {"id": "p3", "email": "new@c.de", "companyName": "C", "status": "NEW"},
            {"id": "p4", "email": "existing@cust.de", "companyName": "Signed Co", "status": "Meeting"},
        ]

    def get_signed_contracts(self, campaign_id, limit=200):
        return [{"companyName": "Beta GmbH"}, {"companyName": "Signed Co"}]

    def upsert_hot_lead(self, row):
        self.hot.append(row["email"]); return {"ok": True}

    def upsert_customer(self, row):
        self.customers_posted.append(row["email"]); return {"ok": True}


@pytest.fixture
def fake_erp():
    fake = FakeErp()
    server.app.dependency_overrides[server.get_erp] = lambda: fake
    yield fake
    server.app.dependency_overrides.clear()


def test_route_crm_dry(fake_erp):
    client = TestClient(server.app)
    data = client.post("/crm/run", json={"live": False}).json()

    assert data["status"] == "ok" and data["mode"] == "dry"
    assert data["counts"] == {"hotLeads": 3, "customers": 1}
    assert data["posted"] == 0
    assert fake_erp.hot == [] and fake_erp.customers_posted == []


def test_route_crm_live_writes(fake_erp):
    client = TestClient(server.app)
    data = client.post("/crm/run", json={"live": True}).json()

    assert data["posted"] == 4   # 3 hot + 1 customer
    assert set(fake_erp.hot) == {"interested@a.de", "meeting@b.de", "existing@cust.de"}
    assert fake_erp.customers_posted == ["meeting@b.de"]


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
