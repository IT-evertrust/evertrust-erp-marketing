"""ERP gateway for Sleeper — the data layer (replaces db.py), behind a Protocol for tests.

Mirrors the ERP machine calls in n8n workflow cZDGIoudM6yg17kV (x-arsenal-token):
  GET   /prospects?snoozeDue=true&limit=100
  POST  /suppressions               (do-not-contact)
  PATCH /prospects/:id              (DO_NOT_CONTACT | RE_ENGAGED)
  POST  /outreach-messages          (OUTBOUND/SENT re-engage)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

from ..domain.models import Prospect, to_prospect


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _unwrap(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "prospects", "results"):
            if isinstance(data.get(key), list):
                return data[key]
        if data.get("id"):
            return [data]
    return []


class ErpGateway(Protocol):
    def get_snooze_due(self, limit: int = 100) -> list[Prospect]: ...
    def add_suppression(self, email: str, prospect_id: str, reason: str = "do-not-contact") -> dict: ...
    def patch_prospect(self, prospect_id: str, updates: dict) -> dict: ...
    def log_outreach(self, prospect_id: str, subject: str, body: str,
                     message_id: str = "", thread_id: str = "") -> dict: ...


class ErpClient:
    def __init__(self, base_url: str, token: str, timeout: float = 60.0) -> None:
        import httpx

        self._http = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"x-arsenal-token": token}, timeout=timeout
        )

    def close(self) -> None:
        self._http.close()

    def get_snooze_due(self, limit: int = 100) -> list[Prospect]:
        r = self._http.get("/prospects", params={"snoozeDue": "true", "limit": limit})
        r.raise_for_status()
        return [to_prospect(x) for x in _unwrap(r.json())]

    def add_suppression(self, email, prospect_id, reason="do-not-contact") -> dict:
        r = self._http.post("/suppressions", json={"email": email, "reason": reason, "sourceProspectId": prospect_id})
        r.raise_for_status()
        return r.json()

    def patch_prospect(self, prospect_id, updates) -> dict:
        r = self._http.patch(f"/prospects/{prospect_id}", json=updates)
        r.raise_for_status()
        return r.json()

    def log_outreach(self, prospect_id, subject, body, message_id="", thread_id="") -> dict:
        payload = {"prospectId": prospect_id, "direction": "OUTBOUND", "status": "SENT",
                   "subject": (subject or "")[:2000], "bodySnippet": (body or "")[:280], "sentAt": _now_iso()}
        if message_id:
            payload["gmailMessageId"] = message_id
        if thread_id:
            payload["gmailThreadId"] = thread_id
        r = self._http.post("/outreach-messages", json=payload)
        r.raise_for_status()
        return r.json()
