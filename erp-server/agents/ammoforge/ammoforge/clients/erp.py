"""ERP gateway for AmmoForge — the only data layer, behind a Protocol so tests use a fake.

Mirrors the ERP machine calls in n8n workflow rDLhY3sqi6U9xK6t (x-arsenal-token):
GET /campaigns/:id/config, POST /campaigns/:id/templates, POST /notifications.
"""
from __future__ import annotations

from typing import Protocol

from ..domain.models import CampaignConfig


def to_config(campaign_id: str, raw: dict) -> CampaignConfig:
    cfg = raw.get("data") if isinstance(raw, dict) and isinstance(raw.get("data"), dict) else raw
    cfg = cfg if isinstance(cfg, dict) else {}
    niche = cfg.get("niche")
    niche_name = niche.get("name") if isinstance(niche, dict) else (niche or "")
    overrides = {}
    automation = cfg.get("automation")
    if isinstance(automation, dict) and isinstance(automation.get("templates"), dict):
        overrides = automation["templates"]
    return CampaignConfig(
        campaign_id=str(cfg.get("campaignId") or cfg.get("id") or campaign_id),
        name=str(cfg.get("name") or ""),
        niche=str(niche_name or ""),
        country=str(cfg.get("country") or ""),
        region=str(cfg.get("region") or ""),
        project=str(cfg.get("project") or ""),
        overrides=overrides,
    )


class ErpGateway(Protocol):
    def fetch_campaign_config(self, campaign_id: str) -> CampaignConfig: ...
    def post_templates(self, campaign_id: str, templates: dict) -> dict: ...
    def post_notification(
        self, ntype: str, title: str, body: str, campaign_id: str | None = None, link: str | None = None
    ) -> dict: ...


class ErpClient:
    def __init__(self, base_url: str, token: str, timeout: float = 60.0) -> None:
        import httpx

        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"x-arsenal-token": token},
            timeout=timeout,
        )

    def close(self) -> None:
        self._http.close()

    def fetch_campaign_config(self, campaign_id: str) -> CampaignConfig:
        r = self._http.get(f"/campaigns/{campaign_id}/config")
        r.raise_for_status()
        return to_config(campaign_id, r.json())

    def post_templates(self, campaign_id: str, templates: dict) -> dict:
        r = self._http.post(f"/campaigns/{campaign_id}/templates", json={"templates": templates})
        r.raise_for_status()
        return r.json()

    def post_notification(
        self, ntype: str, title: str, body: str, campaign_id: str | None = None, link: str | None = None
    ) -> dict:
        payload = {"type": ntype, "title": title, "body": body, "link": link, "campaignId": campaign_id}
        r = self._http.post("/notifications", json=payload)
        r.raise_for_status()
        return r.json()
