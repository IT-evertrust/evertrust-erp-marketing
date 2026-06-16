"""Route -> ContractMaker -> output. FastAPI TestClient + fake ERP/LLM/gdocs: no live ERP,
no Google, no gateway. Mirrors ContractMaker (PG): signing gate -> match -> idempotency ->
generate -> record GENERATED -> mark SIGNED."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from contractmaker import server

MEETING = {
    "title": "PL Container: Baltic Boxes — Signing",
    "summary": "Both sides agreed to sign the contract. Partner: Baltic Boxes Sp. z o.o., Gdynia.",
    "session_id": "s1",
}


class FakeErp:
    def __init__(self, existing=None):
        self.existing = existing or []
        self.recorded, self.signed = [], []

    def list_active_campaigns(self):
        return [{"id": "c1", "niche": "Container", "country": "Poland", "folderId": "f1", "templateAssetId": "t1"}]

    def get_contracts(self, lead_id, campaign_id, limit=1):
        return self.existing

    def record_contract(self, payload):
        self.recorded.append(payload); return {"id": "k1"}

    def mark_signed(self, contract_id, payload):
        self.signed.append((contract_id, payload.get("status"))); return {"ok": True}


class FakeLlm:
    def __init__(self, signing=True):
        self.signing = signing

    def signal_extract(self, settings, text):
        return {"companyName": "Baltic Boxes", "country": "Poland", "niche": "Container",
                "contractSigningMentioned": self.signing, "cooperationTerm": ""}

    def deal_extract(self, settings, aggregate_text):
        return {"partnerLegalName": "Baltic Boxes Sp. z o.o.", "partnerPostalCity": "Gdynia"}


class FakeGdocs:
    def __init__(self):
        self.calls = []

    def generate_contract_pdf(self, settings, template_name, folder_id, file_base, fields):
        self.calls.append(file_base); return "https://drive.example/contract.pdf"


def _wire(erp, llm, gdocs):
    server.app.dependency_overrides[server.get_erp] = lambda: erp
    server.app.dependency_overrides[server.get_llm] = lambda: llm
    server.app.dependency_overrides[server.get_gdocs] = lambda: gdocs


@pytest.fixture(autouse=True)
def cleanup():
    yield
    server.app.dependency_overrides.clear()


def test_route_dry_signing():
    erp, llm, gdocs = FakeErp(), FakeLlm(signing=True), FakeGdocs()
    _wire(erp, llm, gdocs)
    client = TestClient(server.app)
    data = client.post("/contractmaker/run", json={"meeting": MEETING, "live": False, "useLlm": True}).json()

    assert data["status"] == "ok" and data["signNow"] is True
    assert data["action"] == "planned" and data["posted"] is False
    assert data["campaignId"] == "c1"
    assert erp.recorded == [] and gdocs.calls == []


def test_route_live_generates_and_signs():
    erp, llm, gdocs = FakeErp(), FakeLlm(signing=True), FakeGdocs()
    _wire(erp, llm, gdocs)
    client = TestClient(server.app)
    data = client.post("/contractmaker/run", json={"meeting": MEETING, "live": True, "useLlm": True}).json()

    assert data["action"] == "generated_signed" and data["posted"] is True
    assert gdocs.calls and erp.recorded and erp.recorded[0]["status"] == "GENERATED"
    assert erp.signed == [("k1", "SIGNED")]


def test_route_no_signing_skips():
    erp, llm, gdocs = FakeErp(), FakeLlm(signing=False), FakeGdocs()
    _wire(erp, llm, gdocs)
    client = TestClient(server.app)
    data = client.post("/contractmaker/run", json={"meeting": MEETING, "live": True, "useLlm": True}).json()

    assert data["status"] == "no_signing"
    assert erp.recorded == [] and gdocs.calls == []


def test_route_idempotency_skips_existing():
    erp = FakeErp(existing=[{"status": "GENERATED"}])
    _wire(erp, FakeLlm(signing=True), FakeGdocs())
    client = TestClient(server.app)
    data = client.post("/contractmaker/run", json={"meeting": MEETING, "live": True, "useLlm": True}).json()

    assert data["status"] == "exists" and erp.recorded == []


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
