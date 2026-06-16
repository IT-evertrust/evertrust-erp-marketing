"""Route -> reach -> output. When the ERP route calls reach, reach processes and returns
the appropriate output. FastAPI TestClient + a fake ERP gateway: no live ERP, no network,
no LLM, no Gmail. Mirrors the n8n workflow zyCTVLpZj3YyR2qV behaviour.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from bazooka import server
from bazooka.domain.models import Campaign, Prospect

COLD_EMAIL = """[COLD]
Subject: {{companyName}} — German tender opportunity
Body: Hello {{companyName}} team, German public tenders need LED rental.
[FOLLOWUP]
Subject: Following up — {{companyName}}
Body: Just following up with {{companyName}}.
[FINALPUSH]
Subject: Last call — {{companyName}}
Body: Final note for {{companyName}}.
"""


class FakeErp:
    def __init__(self) -> None:
        self.outreach: list = []
        self.failed: list = []
        self.updates: list = []
        self.notifications: list = []
        self.callbacks: list = []

    def fetch_active_campaigns(self):
        return [Campaign(id="c1", name="POLAND CONTAINER 2026", project="POLAND CONTAINER 2026",
                         country="Poland", region="Anywhere", sender="info")]

    def fetch_campaign_config(self, campaign_id):
        return {
            "templates": {"coldEmail": COLD_EMAIL, "newsBrief": ""},
            "niche": "LED Container Rental", "city": "Anywhere",
            "project": "POLAND CONTAINER 2026", "sender": "info",
        }

    def fetch_send_list(self, campaign_id, limit=None):
        return [
            Prospect(id="p1", email="biuro@ledcity.pl", company_name="LEDCity",
                     status="NEW", followup_count=0),                 # -> cold
            Prospect(id="p2", email="contact@rentascreen.pl", company_name="Rent a screen",
                     status="NEW", followup_count=1),                 # -> followup
            Prospect(id="p3", email="office@spyro-soft.com", company_name="Spyrosoft",
                     status="EMAILED", followup_count=0),             # -> finalpush
            Prospect(id="p4", email="broken-at-domain", company_name="Bad Email Co",
                     status="NEW", followup_count=0),                 # -> skip INVALID_EMAIL
        ]

    def record_outreach(self, prospect_id, subject, body, message_id, thread_id, template_asset_id=None):
        self.outreach.append(prospect_id)
        return {"id": "om1"}

    def log_failed_outreach(self, prospect_id, subject, reason, template_asset_id=None):
        self.failed.append((prospect_id, reason))
        return {"id": "omf"}

    def update_prospect(self, prospect_id, status, followup_count):
        self.updates.append((prospect_id, status, followup_count))
        return {"id": prospect_id}

    def post_notification(self, ntype, title, body, campaign_id=None):
        self.notifications.append(ntype)
        return {"id": "n1"}

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
    data = client.post("/reach/run", json={"live": False, "useLlm": False}).json()

    assert data["mode"] == "dry"
    assert data["counts"]["cold"] == 1        # p1
    assert data["counts"]["followup"] == 1    # p2 (fu 1)
    assert data["counts"]["finalpush"] == 1   # p3 (EMAILED)
    assert data["counts"]["skipped"] == 1     # p4 invalid email
    assert data["emailsSent"] == 3

    # block templates parsed + personalised
    planned = [x for c in data["campaigns"] for x in c["planned"] if x.get("status") == "planned"]
    cold = next(x for x in planned if x["action"] == "cold")
    assert cold["block"] == "COLD" and "LEDCity" in cold["subject"]

    # dry-run: zero ERP writes
    assert fake_erp.outreach == [] and fake_erp.updates == [] and fake_erp.callbacks == []


def test_route_calls_reach_live_writes(fake_erp, monkeypatch):
    from bazooka.clients import gmail

    monkeypatch.setattr(gmail, "html_body", lambda body, sig: body)
    monkeypatch.setattr(gmail, "send_html", lambda *a, **k: ("mid", "thread"))

    client = TestClient(server.app)
    data = client.post("/reach/run", json={"live": True, "useLlm": False}).json()

    assert data["mode"] == "live"
    assert fake_erp.outreach == ["p1", "p2", "p3"]
    assert fake_erp.updates == [("p1", "EMAILED", 1), ("p2", "EMAILED", 2), ("p3", "EMAILED", 1)]
    assert fake_erp.callbacks == [("SUCCESS", {"emailsSent": 3})]
    # ERP notifications fired (run start + campaign activated + outbound summary)
    assert "REACH_BAZOOKA_RUN_START" in fake_erp.notifications
    assert "REACH_BAZOOKA_CAMPAIGN_ACTIVATED" in fake_erp.notifications
    assert "REACH_BAZOOKA_OUTBOUND_SUMMARY" in fake_erp.notifications


def test_send_cap(fake_erp, monkeypatch):
    from bazooka.clients import gmail

    monkeypatch.setattr(gmail, "html_body", lambda body, sig: body)
    monkeypatch.setattr(gmail, "send_html", lambda *a, **k: ("mid", "thread"))

    client = TestClient(server.app)
    data = client.post("/reach/run", json={"live": True, "useLlm": False, "limit": 1}).json()

    assert data["emailsSent"] == 1                # cap honoured
    assert fake_erp.outreach == ["p1"]
    capped = [x for c in data["campaigns"] for x in c["planned"] if x.get("status") == "capped"]
    assert len(capped) >= 1


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
