"""Route -> Reply Glock -> output. FastAPI TestClient + fake ERP/Gmail/Calendar/LLM:
no live ERP, no Gmail/Calendar, no gateway. Mirrors REPLY GLOCK (PG) v2 routing.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glock import server
from glock.domain import classify as classify_domain
from glock.domain.models import Reply


def _reply(mid, frm, text):
    return Reply(message_id=mid, thread_id="t-" + mid, from_email=frm, subject="Re: Tenders",
                 reply_text=text, account="info")


class FakeErp:
    def __init__(self):
        self.inbound, self.classifications, self.graduations, self.notifications = [], [], [], []
        self._prospects = {
            "yes@acme.de": {"id": "p1", "campaignId": "c1", "companyName": "Acme", "status": "EMAILED"},
            "maybe@beta.de": {"id": "p2", "campaignId": "c1", "companyName": "Beta", "status": "EMAILED"},
            "stop@gamma.de": {"id": "p3", "campaignId": "c1", "companyName": "Gamma", "status": "EMAILED"},
        }

    def list_active_campaigns(self):
        return [{"campaignId": "c1", "campaignName": "POLAND CONTAINER 2026", "driveFolderId": None}]

    def get_campaign_config(self, cid):
        return {"name": "POLAND CONTAINER 2026", "niche": {"name": "LED"}, "region": "Berlin",
                "project": "POLAND CONTAINER 2026", "sender": "hanna", "templates": {"coldEmail": "x"}}

    def get_prospect_by_email(self, email):
        return self._prospects.get(email)

    def log_inbound_message(self, *a, **k):
        self.inbound.append(a[0]); return {"ok": True}

    def post_reply_classification(self, prospect_id, verdict, raw, model="hermes", snooze_until=None):
        self.classifications.append((prospect_id, verdict)); return {"ok": True}

    def graduate(self, prospect_id, stage, hot_reason):
        self.graduations.append((prospect_id, stage)); return {"ok": True}

    def post_notification(self, *a, **k):
        self.notifications.append(a[0]); return {"ok": True}


class FakeGmail:
    def __init__(self):
        self.drafts, self.sent, self.read = [], [], []

    def fetch_replies(self, settings, account, query):
        if account != "info":
            return []
        return [
            _reply("m1", "yes@acme.de", "Yes, interested — let's talk."),
            _reply("m2", "maybe@beta.de", "Hmm, can you send more info?"),
            _reply("m3", "stop@gamma.de", "Please unsubscribe, do not contact us."),
            _reply("m4", "ghost@nope.de", "Who are you?"),
        ]

    def create_draft(self, settings, account, to, thread_id, subject, body_html):
        self.drafts.append(to); return "draft-1"

    def send_reply(self, settings, account, to, thread_id, subject, body_html):
        self.sent.append(to); return "sent-1"

    def mark_read(self, settings, account, message_id):
        self.read.append(message_id)


class FakeCalendar:
    def busy_windows(self, settings, now, days_ahead):
        return []

    def create_meeting(self, settings, company, project, attendee, start, end):
        return "https://meet.example/x"


class FakeLlm:
    def classify(self, settings, lead, reply, today, now):
        return classify_domain.offline_classify(reply.reply_text, today, now)

    def draft_proposal(self, settings, lead, reply, slot1, slot2):
        return f"Dear {lead.company_name}, here are two slots: {slot1.human} / {slot2.human}"


@pytest.fixture
def fakes():
    erp, gmail, cal, llm = FakeErp(), FakeGmail(), FakeCalendar(), FakeLlm()
    server.app.dependency_overrides[server.get_erp] = lambda: erp
    server.app.dependency_overrides[server.get_gmail] = lambda: gmail
    server.app.dependency_overrides[server.get_calendar] = lambda: cal
    server.app.dependency_overrides[server.get_llm] = lambda: llm
    server.app.dependency_overrides[server.get_whatsapp] = lambda: None
    yield erp, gmail, cal, llm
    server.app.dependency_overrides.clear()


def test_route_glock_dry(fakes):
    erp, gmail, cal, llm = fakes
    client = TestClient(server.app)
    data = client.post("/glock/run", json={"live": False, "useLlm": True}).json()

    assert data["mode"] == "dry"
    c = data["counts"]
    assert c["interested"] == 1      # acme
    assert c["unsure"] == 1          # beta
    assert c["not_interested"] == 1  # gamma (unsubscribe -> permanent)
    assert c["skipped"] == 1         # nope -> no prospect
    # dry: no writes anywhere
    assert erp.inbound == [] and erp.classifications == [] and erp.graduations == []
    assert gmail.drafts == [] and gmail.read == []


def test_route_glock_live_writes(fakes):
    erp, gmail, cal, llm = fakes
    client = TestClient(server.app)
    data = client.post("/glock/run", json={"live": True, "useLlm": True}).json()

    assert data["mode"] == "live"
    # 3 matched prospects logged + marked read
    assert set(erp.inbound) == {"p1", "p2", "p3"}
    assert len(gmail.read) == 3
    # interested -> draft proposal + graduate + INTERESTED verdict
    assert gmail.drafts == ["yes@acme.de"]
    assert ("p1", "INTERESTED") in erp.graduations
    verdicts = dict(erp.classifications)
    assert verdicts["p1"] == "INTERESTED"
    assert verdicts["p2"] == "UNSURE"
    assert verdicts["p3"] == "NOT_INTERESTED"


def test_health():
    client = TestClient(server.app)
    assert client.get("/health").json()["ok"] is True
