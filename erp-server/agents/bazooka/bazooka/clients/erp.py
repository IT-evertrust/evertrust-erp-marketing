"""ERP gateway — reach's data access, behind an interface so it's swappable in tests.

Reach is meant to live as backend logic the ERP invokes (route -> reach.run -> output).
All reads/writes go through the ERP machine API (x-arsenal-token), exactly like the n8n
REACH BAZOOKA (PG) workflow it replaces. Contract: AGENT-BLUEPRINTS/REACH-ERP-CONTRACT.md.

`ErpGateway` is the Protocol the pipeline depends on; `ErpClient` is the real httpx
implementation; tests inject a fake that returns canned campaigns/prospects.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

from ..domain.models import Campaign, Prospect


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _unwrap(data) -> list:
    """ERP list endpoints may return a bare array or {data|items|...: [...]}."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "prospects", "campaigns", "results"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def to_campaign(x: dict) -> Campaign:
    return Campaign(
        id=str(x.get("id") or ""),
        name=str(x.get("name") or x.get("project") or ""),
        project=str(x.get("project") or ""),
        country=str(x.get("country") or ""),
        region=str(x.get("region") or ""),
        sender=str(x.get("sender") or "info"),
        niche=str(x.get("niche") or ""),
    )


def to_prospect(x: dict) -> Prospect:
    return Prospect(
        id=str(x.get("id") or ""),
        email=str(x.get("email") or ""),
        company_name=str(x.get("companyName") or x.get("company_name") or ""),
        website=str(x.get("website") or ""),
        city=str(x.get("city") or ""),
        country=str(x.get("country") or ""),
        status=str(x.get("status") or "NEW"),
        followup_count=int(x.get("followupCount") or x.get("followup_count") or 0),
        last_contacted_at=x.get("lastContactedAt") or x.get("last_contacted_at"),
    )


class ErpGateway(Protocol):
    def fetch_active_campaigns(self) -> list[Campaign]: ...
    def fetch_campaign_config(self, campaign_id: str) -> dict: ...
    def fetch_send_list(self, campaign_id: str, limit: int | None = None) -> list[Prospect]: ...
    def record_outreach(
        self, prospect_id: str, subject: str, body: str, message_id: str, thread_id: str
    ) -> dict: ...
    def update_prospect(self, prospect_id: str, status: str, followup_count: int) -> dict: ...
    def post_run_callback(self, status: str, metrics: dict, detail: str = "") -> dict: ...


class ErpClient:
    """Real ERP machine-API client over HTTP (httpx)."""

    def __init__(self, base_url: str, token: str, timeout: float = 30.0) -> None:
        import httpx  # lazy: tests use the fake and need no httpx/network

        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"x-arsenal-token": token},
            timeout=timeout,
        )

    def close(self) -> None:
        self._http.close()

    def fetch_active_campaigns(self) -> list[Campaign]:
        r = self._http.get("/campaigns/machine/list", params={"lifecycle": "ACTIVE"})
        r.raise_for_status()
        return [to_campaign(x) for x in _unwrap(r.json())]

    def fetch_campaign_config(self, campaign_id: str) -> dict:
        r = self._http.get(f"/campaigns/{campaign_id}/config")
        r.raise_for_status()
        return r.json()

    def fetch_send_list(self, campaign_id: str, limit: int | None = None) -> list[Prospect]:
        params: dict = {"campaignId": campaign_id, "sendList": "true"}
        if limit:
            params["limit"] = limit
        r = self._http.get("/prospects", params=params)
        r.raise_for_status()
        return [to_prospect(x) for x in _unwrap(r.json())]

    def record_outreach(
        self, prospect_id: str, subject: str, body: str, message_id: str, thread_id: str
    ) -> dict:
        payload = {
            "prospectId": prospect_id,
            "direction": "OUTBOUND",
            "status": "SENT",
            "subject": subject[:2000],
            "bodySnippet": body[:8000],
            "sentAt": _now_iso(),
        }
        if message_id:
            payload["gmailMessageId"] = message_id
        if thread_id:
            payload["gmailThreadId"] = thread_id
        r = self._http.post("/outreach-messages", json=payload)
        r.raise_for_status()
        return r.json()

    def update_prospect(self, prospect_id: str, status: str, followup_count: int) -> dict:
        payload = {
            "status": status,
            "followupCount": followup_count,
            "lastContactedAt": _now_iso(),
        }
        r = self._http.patch(f"/prospects/{prospect_id}", json=payload)
        r.raise_for_status()
        return r.json()

    def post_run_callback(self, status: str, metrics: dict, detail: str = "") -> dict:
        payload: dict = {"stage": "REACH_BAZOOKA", "status": status, "metrics": metrics}
        if detail:
            payload["detail"] = detail[:500]
        r = self._http.post("/arsenal/runs/callback", json=payload)
        r.raise_for_status()
        return r.json()
