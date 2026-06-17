"""ERP gateway for RAG Agent — the data layer (replaces db.py), behind a Protocol for tests.

Mirrors the ERP machine calls in n8n workflow ffd3c2uRgkMLFaxT (x-arsenal-token):
  GET  /reply-classifications?needsRag=true&limit=50   (UNSURE backlog needing a draft)
  GET  /outreach-messages?prospectId=&limit=50         (thread context)
  POST /reply-classifications                           (verdict UNSURE + suggestedReply)
  POST /notifications                                   (RAG_DRAFT_READY)
"""
from __future__ import annotations

from typing import Protocol


def _unwrap(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "messages", "results"):
            if isinstance(data.get(key), list):
                return data[key]
        if data.get("id"):
            return [data]
    return []


class ErpGateway(Protocol):
    def get_rag_backlog(self, limit: int = 50) -> list[dict]: ...
    def get_thread(self, prospect_id: str, limit: int = 50) -> list[dict]: ...
    def save_draft(self, prospect_id: str, model: str, raw: str, suggested_reply: str) -> dict: ...
    def notify_draft_ready(self, campaign_id: str, unsure_area: str, subject: str) -> dict: ...


class ErpClient:
    def __init__(self, base_url: str, token: str, timeout: float = 60.0) -> None:
        import httpx

        self._http = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"x-arsenal-token": token}, timeout=timeout
        )

    def close(self) -> None:
        self._http.close()

    def get_rag_backlog(self, limit: int = 50) -> list[dict]:
        r = self._http.get("/reply-classifications", params={"needsRag": "true", "limit": limit})
        r.raise_for_status()
        return _unwrap(r.json())

    def get_thread(self, prospect_id: str, limit: int = 50) -> list[dict]:
        r = self._http.get("/outreach-messages", params={"prospectId": prospect_id, "limit": limit})
        r.raise_for_status()
        return _unwrap(r.json())

    def save_draft(self, prospect_id, model, raw, suggested_reply) -> dict:
        payload = {"prospectId": prospect_id, "verdict": "UNSURE", "model": model,
                   "raw": raw, "suggestedReply": suggested_reply}
        r = self._http.post("/reply-classifications", json=payload)
        r.raise_for_status()
        return r.json()

    def notify_draft_ready(self, campaign_id, unsure_area, subject) -> dict:
        payload = {"type": "RAG_DRAFT_READY", "title": f"RAG draft ready for {unsure_area or 'review'}",
                   "body": subject, "link": f"/campaigns/{campaign_id}", "campaignId": campaign_id}
        r = self._http.post("/notifications", json=payload)
        r.raise_for_status()
        return r.json()
