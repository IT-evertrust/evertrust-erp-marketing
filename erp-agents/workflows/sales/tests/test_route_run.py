"""Route -> Sales Agent -> output. FastAPI TestClient + fake ERP (personas/save) + the real
offline coach (useLlm=False) so it's deterministic with no gateway. Mirrors SALES AGENT (PG)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sales import server

# A valid transcript: >=100 words, >=4 turns, salesperson speaks.
_TURN = "We can absolutely help with that and here is exactly how the rollout would work for you "
TRANSCRIPT = "\n".join([
    f"[00:0{i}] {'Alex' if i % 2 == 0 else 'Client'}: {_TURN} point number {i} in detail today"
    for i in range(6)
])


class FakeErp:
    def __init__(self):
        self.saved = []

    def get_personas(self, limit=50):
        return [{"name": "Alex Hormozi", "prompt": "You are Alex Hormozi, a sales coach."}]

    def save_meeting_analysis(self, row):
        self.saved.append(row); return {"id": "ma1"}


@pytest.fixture
def fake_erp():
    fake = FakeErp()
    server.app.dependency_overrides[server.get_erp] = lambda: fake
    yield fake
    server.app.dependency_overrides.clear()


def test_route_sales_erp_source_returns_json(fake_erp):
    client = TestClient(server.app)
    data = client.post("/sales/run", json={"transcript": TRANSCRIPT, "persona": "Alex Hormozi",
                                            "source": "erp", "useLlm": False}).json()
    assert data["status"] == "ok" and data["source"] == "erp"
    assert "analysis" in data and "performance_score" in data["analysis"]
    assert data["persisted"] is False
    assert fake_erp.saved == []   # erp source never persists


def test_route_sales_manual_live_persists(fake_erp):
    client = TestClient(server.app)
    data = client.post("/sales/run", json={"transcript": TRANSCRIPT, "persona": "Alex Hormozi",
                                            "source": "manual", "live": True, "useLlm": False}).json()
    assert data["status"] == "ok" and data["persisted"] is True
    assert len(fake_erp.saved) == 1
    row = fake_erp.saved[0]
    assert "report_html" in row and "performance_score" in row and row["persona"] == "Alex Hormozi"


def test_route_sales_invalid_transcript(fake_erp):
    client = TestClient(server.app)
    data = client.post("/sales/run", json={"transcript": "too short", "source": "erp", "useLlm": False}).json()
    assert data["status"] == "invalid" and data["valid"] is False


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
