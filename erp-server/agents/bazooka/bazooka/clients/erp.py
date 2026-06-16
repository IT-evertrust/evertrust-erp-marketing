"""ERP gateway — reach's data access, behind an interface so it's swappable in tests.

Mirrors every ERP machine call the n8n workflow zyCTVLpZj3YyR2qV makes (x-arsenal-token):
GET /campaigns/machine/list, GET /campaigns/:id/config, GET /prospects?sendList=true,
POST /outreach-messages (SENT/FAILED), PATCH /prospects/:id, POST /notifications,
POST /arsenal/runs/callback.

`ErpGateway` is the Protocol the pipeline depends on; `ErpClient` is the real httpx impl;
tests inject a fake.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

from ..domain.models import Campaign, Prospect


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _unwrap(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "prospects", "campaigns", "results"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def to_campaign(x: dict) -> Campaign:
    return Campaign(
        id=str(x.get("id") or x.get("campaignId") or ""),
        name=str(x.get("name") or x.get("campaignName") or x.get("project") or ""),
        project=str(x.get("project") or ""),
        country=str(x.get("country") or ""),
        region=str(x.get("region") or ""),
        sender=str(x.get("sender") or "info"),
        niche=str(x.get("niche") or ""),
    )


def to_prospect(x: dict) -> Prospect:
    return Prospect(
        id=str(x.get("id") or x.get("prospectId") or ""),
        email=str(x.get("email") or x.get("contactEmail") or ""),
        company_name=str(x.get("companyName") or x.get("company") or x.get("company_name") or ""),
        company_type=str(x.get("companyType") or x.get("company_type") or ""),
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
        self, prospect_id: str, subject: str, body: str, message_id: str, thread_id: str,
        template_asset_id: str | None = None,
    ) -> dict: ...
    def log_failed_outreach(
        self, prospect_id: str, subject: str, reason: str, template_asset_id: str | None = None
    ) -> dict: ...
    def update_prospect(self, prospect_id: str, status: str, followup_count: int) -> dict: ...
    def post_notification(
        self, ntype: str, title: str, body: str, campaign_id: str | None = None
    ) -> dict: ...
    def post_run_callback(self, status: str, metrics: dict, detail: str = "") -> dict: ...


class ErpClient:
    """Real ERP machine-API client over HTTP (httpx)."""

    def __init__(self, base_url: str, token: str, timeout: float = 30.0) -> None:
        import httpx

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
        data = r.json()
        # the n8n workflow unwraps a {data:{...}} envelope
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            return data["data"]
        return data if isinstance(data, dict) else {}

    def fetch_send_list(self, campaign_id: str, limit: int | None = None) -> list[Prospect]:
        params: dict = {"sendList": "true", "campaignId": campaign_id}
        if limit:
            params["limit"] = limit
        r = self._http.get("/prospects", params=params)
        r.raise_for_status()
        return [to_prospect(x) for x in _unwrap(r.json())]

    def record_outreach(
        self, prospect_id: str, subject: str, body: str, message_id: str, thread_id: str,
        template_asset_id: str | None = None,
    ) -> dict:
        payload = {
            "prospectId": prospect_id,
            "direction": "OUTBOUND",
            "status": "SENT",
            "subject": subject[:2000],
            "bodySnippet": " ".join(body.split())[:280],
            "sentAt": _now_iso(),
        }
        if message_id:
            payload["gmailMessageId"] = message_id
        if thread_id:
            payload["gmailThreadId"] = thread_id
        if template_asset_id:
            payload["templateAssetId"] = template_asset_id
        r = self._http.post("/outreach-messages", json=payload)
        r.raise_for_status()
        return r.json()

    def log_failed_outreach(
        self, prospect_id: str, subject: str, reason: str, template_asset_id: str | None = None
    ) -> dict:
        payload = {
            "prospectId": prospect_id,
            "direction": "OUTBOUND",
            "status": "FAILED",
            "subject": subject[:2000],
            "bodySnippet": (reason or "outreach failed")[:280],
        }
        if template_asset_id:
            payload["templateAssetId"] = template_asset_id
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

    def post_notification(
        self, ntype: str, title: str, body: str, campaign_id: str | None = None
    ) -> dict:
        # Omit optional null fields — the ERP zod schema expects them absent, not null.
        payload = {"type": ntype, "title": title, "body": body}
        if campaign_id:
            payload["campaignId"] = campaign_id
        r = self._http.post("/notifications", json=payload)
        r.raise_for_status()
        return r.json()

    def post_run_callback(
        self, status: str, metrics: dict, detail: str = "", campaign_id: str | None = None
    ) -> dict:
        payload: dict = {"stage": "REACH_BAZOOKA", "status": status, "metrics": metrics}
        if campaign_id:
            payload["campaignId"] = campaign_id
        if detail:
            payload["detail"] = detail[:500]
        r = self._http.post("/arsenal/runs/callback", json=payload)
        r.raise_for_status()
        return r.json()
