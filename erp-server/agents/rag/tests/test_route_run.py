"""Route -> RAG Agent -> output. FastAPI TestClient + fake ERP/LLM: no live ERP, no gateway.
Mirrors RAG AGENT (PG): backlog -> thread -> draft -> save suggestedReply + notify."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from rag import server

_DRAFT = json.dumps({
    "subject": "Zu Ihrer Preisfrage",
    "unsureSection": "we're unsure about pricing",
    "unsureSignal": "pricing hesitation",
    "unsureArea": "Finance",
    "areaExplanation": "the lead asks about cost and budget",
    "draftReply": "Dear Acme,\n\nThank you for getting back to us...",
    "citations": [],
})


class FakeErp:
    def __init__(self):
        self.saved, self.notifs = [], []

    def get_rag_backlog(self, limit=50):
        return [{"prospectId": "p1", "campaignId": "c1", "prospectEmail": "lead@x.de",
                 "companyName": "Acme", "country": "DE"}]

    def get_thread(self, prospect_id, limit=50):
        return [{"direction": "INBOUND", "sentAt": "2026-06-10T10:00:00Z", "fromAddress": "lead@x.de",
                 "subject": "Re: Tender", "bodySnippet": "we're unsure about pricing"}]

    def save_draft(self, prospect_id, model, raw, suggested_reply):
        self.saved.append((prospect_id, suggested_reply)); return {"ok": True}

    def notify_draft_ready(self, campaign_id, unsure_area, subject):
        self.notifs.append((campaign_id, unsure_area)); return {"ok": True}


class FakeLlm:
    def analyze(self, settings, system, user):
        return _DRAFT


@pytest.fixture
def fakes():
    erp, llm = FakeErp(), FakeLlm()
    server.app.dependency_overrides[server.get_erp] = lambda: erp
    server.app.dependency_overrides[server.get_llm] = lambda: llm
    yield erp, llm
    server.app.dependency_overrides.clear()


def test_route_rag_dry(fakes):
    erp, llm = fakes
    client = TestClient(server.app)
    data = client.post("/rag/run", json={"live": False, "useLlm": True}).json()

    assert data["mode"] == "dry"
    assert data["counts"] == {"backlog": 1, "drafted": 1, "saved": 0, "errors": 0}
    d = data["drafts"][0]
    assert d["status"] == "drafted" and d["unsureArea"] == "Finance" and d["draftChars"] > 0
    assert erp.saved == [] and erp.notifs == []


def test_route_rag_live_writes(fakes):
    erp, llm = fakes
    client = TestClient(server.app)
    data = client.post("/rag/run", json={"live": True, "useLlm": True}).json()

    assert data["counts"]["saved"] == 1
    assert erp.saved[0][0] == "p1" and erp.saved[0][1].startswith("Dear Acme")
    assert erp.notifs == [("c1", "Finance")]


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
