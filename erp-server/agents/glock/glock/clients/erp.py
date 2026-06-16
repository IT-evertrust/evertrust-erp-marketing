"""ERP gateway for Reply Glock — the data layer (replaces db.py), behind a Protocol so tests
use a fake. Mirrors the ERP machine calls in n8n workflow 5QkBzSzK1UdxiE96 (x-arsenal-token):

  GET  /campaigns/machine/list?lifecycle=ACTIVE
  GET  /campaigns/:id/config
  GET  /prospects?email=&limit=1            (match a reply to a prospect)
  POST /outreach-messages                   (log INBOUND/RECEIVED reply)
  POST /reply-classifications               (verdict: INTERESTED|UNSURE|NOT_INTERESTED|SNOOZE|MEETING_REQUEST)
  POST /prospects/:id/graduate              (stage INTERESTED + hotReason)
  POST /notifications                       (manager pings, parallel to WhatsApp)
"""
from __future__ import annotations

from typing import Protocol


def _unwrap(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if data.get("id"):
            return [data]
        for key in ("data", "items", "prospects", "campaigns", "results"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


class ErpGateway(Protocol):
    def list_active_campaigns(self) -> list[dict]: ...
    def get_campaign_config(self, campaign_id: str) -> dict: ...
    def get_prospect_by_email(self, email: str) -> dict | None: ...
    def log_inbound_message(self, prospect_id: str, message_id: str, thread_id: str,
                            subject: str, body: str) -> dict: ...
    def post_reply_classification(self, prospect_id: str, verdict: str, raw: dict,
                                  model: str = "hermes", snooze_until: str | None = None) -> dict: ...
    def graduate(self, prospect_id: str, stage: str, hot_reason: str) -> dict: ...
    def post_notification(self, ntype: str, title: str, body: str,
                          campaign_id: str | None = None, link: str | None = None) -> dict: ...


class ErpClient:
    def __init__(self, base_url: str, token: str, timeout: float = 60.0) -> None:
        import httpx

        self._http = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"x-arsenal-token": token}, timeout=timeout
        )

    def close(self) -> None:
        self._http.close()

    def list_active_campaigns(self) -> list[dict]:
        r = self._http.get("/campaigns/machine/list", params={"lifecycle": "ACTIVE"})
        r.raise_for_status()
        return [{"campaignId": c.get("id"), "campaignName": c.get("name") or "(unnamed)",
                 "driveFolderId": c.get("driveFolderId")} for c in _unwrap(r.json()) if c.get("id")]

    def get_campaign_config(self, campaign_id: str) -> dict:
        r = self._http.get(f"/campaigns/{campaign_id}/config")
        r.raise_for_status()
        data = r.json()
        return data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), dict) else data

    def get_prospect_by_email(self, email: str) -> dict | None:
        r = self._http.get("/prospects", params={"email": email, "limit": 1})
        if r.status_code >= 400:
            return None
        rows = _unwrap(r.json())
        return rows[0] if rows and rows[0].get("id") else None

    def log_inbound_message(self, prospect_id, message_id, thread_id, subject, body) -> dict:
        payload = {"prospectId": prospect_id, "direction": "INBOUND", "status": "RECEIVED",
                   "gmailMessageId": message_id or "", "gmailThreadId": thread_id or "",
                   "subject": (subject or "")[:2000], "bodySnippet": (body or "")[:8000]}
        r = self._http.post("/outreach-messages", json=payload)
        r.raise_for_status()
        return r.json()

    def post_reply_classification(self, prospect_id, verdict, raw, model="hermes", snooze_until=None) -> dict:
        payload = {"prospectId": prospect_id, "verdict": verdict, "model": model, "raw": raw}
        if snooze_until:
            payload["snoozeUntil"] = snooze_until
        r = self._http.post("/reply-classifications", json=payload)
        r.raise_for_status()
        return r.json()

    def graduate(self, prospect_id, stage, hot_reason) -> dict:
        r = self._http.post(f"/prospects/{prospect_id}/graduate", json={"stage": stage, "hotReason": hot_reason})
        r.raise_for_status()
        return r.json()

    def post_notification(self, ntype, title, body, campaign_id=None, link=None) -> dict:
        payload = {"type": ntype, "title": title, "body": body, "link": link, "campaignId": campaign_id}
        r = self._http.post("/notifications", json=payload)
        r.raise_for_status()
        return r.json()
