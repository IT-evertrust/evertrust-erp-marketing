"""Route -> Sleeper -> output. FastAPI TestClient + fake ERP/LLM/Gmail: no live ERP, no network.
Mirrors SLEEPER GRENADE (PG) routing."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sleeper import server
from sleeper.domain.models import Prospect, ReengageDraft


class FakeErp:
    def __init__(self):
        self.suppressions, self.patches, self.outreach = [], [], []

    def get_snooze_due(self, limit=100):
        return [
            Prospect(id="p1", email="dnc@x.de", company_name="StopCo", do_not_contact=True),
            Prospect(id="p2", email="wake@y.de", company_name="Beta", first_name="Anna", followup_count=1),
        ]

    def add_suppression(self, email, prospect_id, reason="do-not-contact"):
        self.suppressions.append((email, prospect_id)); return {"ok": True}

    def patch_prospect(self, prospect_id, updates):
        self.patches.append((prospect_id, updates.get("status"))); return {"ok": True}

    def log_outreach(self, prospect_id, subject, body, message_id="", thread_id=""):
        self.outreach.append(prospect_id); return {"ok": True}


class FakeLlm:
    def draft_reengage(self, settings, p):
        return ReengageDraft(subject=f"Re: {p.company_name}", body="kurzer Text")

    def offline_reengage(self, p):
        return self.draft_reengage(None, p)


class FakeGmail:
    def __init__(self):
        self.sent = []

    def send_text(self, settings, account, to, subject, body):
        self.sent.append(to); return "mid-1", "thread-1"


@pytest.fixture
def fakes():
    erp, llm, gmail = FakeErp(), FakeLlm(), FakeGmail()
    server.app.dependency_overrides[server.get_erp] = lambda: erp
    server.app.dependency_overrides[server.get_llm] = lambda: llm
    server.app.dependency_overrides[server.get_gmail] = lambda: gmail
    server.app.dependency_overrides[server.get_whatsapp] = lambda: None
    yield erp, llm, gmail
    server.app.dependency_overrides.clear()


def test_route_sleeper_dry(fakes):
    erp, llm, gmail = fakes
    client = TestClient(server.app)
    data = client.post("/sleeper/run", json={"live": False, "useLlm": True}).json()

    assert data["mode"] == "dry"
    c = data["counts"]
    assert c["due"] == 2 and c["doNotContact"] == 1 and c["reengaged"] == 1
    # dry: no writes / sends
    assert erp.suppressions == [] and erp.patches == [] and erp.outreach == [] and gmail.sent == []


def test_route_sleeper_live_writes(fakes):
    erp, llm, gmail = fakes
    client = TestClient(server.app)
    data = client.post("/sleeper/run", json={"live": True, "useLlm": True}).json()

    assert data["mode"] == "live"
    # do-not-contact -> suppression + DO_NOT_CONTACT
    assert erp.suppressions == [("dnc@x.de", "p1")]
    assert ("p1", "DO_NOT_CONTACT") in erp.patches
    # re-engage -> gmail send + outreach log + RE_ENGAGED
    assert gmail.sent == ["wake@y.de"]
    assert erp.outreach == ["p2"]
    assert ("p2", "RE_ENGAGED") in erp.patches


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
