"""The integration test the user asked for: when a route calls reach, reach processes
and returns the appropriate output. Uses FastAPI's TestClient + a fake ERP gateway, so it
runs with no live ERP, no network, no LLM, no Gmail.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from bazooka import server
from bazooka.domain.models import Campaign, Prospect


class FakeErp:
    """Canned ERP machine API. Records writes so live behaviour can be asserted."""

    def __init__(self) -> None:
        self.outreach: list = []
        self.updates: list = []
        self.callbacks: list = []

    def fetch_active_campaigns(self):
        return [
            Campaign(
                id="c1", name="POLAND CONTAINER 2026", project="POLAND CONTAINER 2026",
                country="Poland", region="Anywhere", sender="info",
            )
        ]

    def fetch_campaign_config(self, campaign_id):
        return {
            "templates": {
                "coldEmail": "Hello {{companyName}} team, German public tenders need LED rental.",
                "followUp": "Following up with {{companyName}} about German tenders.",
            },
            "niche": {"name": "LED Container Rental"},
            "region": "Anywhere",
            "project": "POLAND CONTAINER 2026",
            "sender": "info",
        }

    def fetch_send_list(self, campaign_id, limit=None):
        return [
            Prospect(id="p1", email="biuro@ledcity.pl", company_name="LEDCity",
                     status="NEW", followup_count=0),
            Prospect(id="p2", email="contact@rentascreen.pl", company_name="Rent a screen",
                     status="EMAILED", followup_count=1),
            Prospect(id="p3", email="broken-at-domain", company_name="Bad Email Co",
                     status="NEW", followup_count=0),
        ]

    def record_outreach(self, prospect_id, subject, body, message_id, thread_id):
        self.outreach.append(prospect_id)
        return {"id": "om1"}

    def update_prospect(self, prospect_id, status, followup_count):
        self.updates.append((prospect_id, status, followup_count))
        return {"id": prospect_id}

    def post_run_callback(self, status, metrics, detail=""):
        self.callbacks.append((status, metrics))
        return {"ok": True}


@pytest.fixture
def fake_erp():
    fake = FakeErp()
    server.app.dependency_overrides[server.get_erp] = lambda: fake
    yield fake
    server.app.dependency_overrides.clear()


def test_route_calls_reach_dry(fake_erp):
    client = TestClient(server.app)
    resp = client.post("/reach/run", json={"live": False, "useLlm": False})
    assert resp.status_code == 200
    data = resp.json()

    # appropriate output: dry mode, correct decision matrix
    assert data["mode"] == "dry"
    assert data["counts"]["cold"] == 1       # p1 NEW, followup 0 -> cold
    assert data["counts"]["followup"] == 1   # p2 followup 1 -> followup
    assert data["counts"]["skipped"] == 1    # p3 invalid email -> skip
    assert data["emailsSent"] == 2

    # dry-run: NO ERP writes
    assert fake_erp.outreach == []
    assert fake_erp.updates == []
    assert fake_erp.callbacks == []

    # the fire plan carries personalised, placeholder-filled copy
    planned = [x for c in data["campaigns"] for x in c["planned"] if x.get("status") == "planned"]
    assert any("LEDCity" in (p.get("subject", "") + p.get("body", "")) for p in planned)


def test_route_calls_reach_live_writes(fake_erp, monkeypatch):
    # stub Gmail so 'live' performs ERP writes without real OAuth/sends
    from bazooka.clients import gmail

    monkeypatch.setattr(gmail, "html_body", lambda body, sig: body)
    monkeypatch.setattr(gmail, "send_html", lambda *a, **k: ("mid-1", "thread-1"))

    client = TestClient(server.app)
    resp = client.post("/reach/run", json={"live": True, "useLlm": False})
    data = resp.json()

    assert data["mode"] == "live"
    assert len(fake_erp.outreach) == 2          # p1 + p2 sent (p3 skipped)
    assert fake_erp.updates == [("p1", "EMAILED", 1), ("p2", "EMAILED", 2)]
    assert fake_erp.callbacks == [("SUCCESS", {"emailsSent": 2})]


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
