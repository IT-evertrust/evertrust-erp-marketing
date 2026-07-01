"""ERP gateway for Satellite — the data layer, behind a Protocol so tests use a fake.

Mirrors the ERP machine calls in n8n workflow dCGzrlpaxpxJanbJ (x-arsenal-token):
GET /campaigns/:id/config, POST /prospects/bulk, POST /arsenal/runs/callback,
plus the niche-analytics trigger used by the niche gate.
"""
from __future__ import annotations

from typing import Protocol

from ..domain.models import CampaignConfig


def to_config(campaign_id: str, raw: dict) -> CampaignConfig:
    body = raw.get("data") if isinstance(raw, dict) and isinstance(raw.get("data"), dict) and not raw.get("campaignId") else raw
    body = body if isinstance(body, dict) else {}
    niche = body.get("niche") if isinstance(body.get("niche"), dict) else {}
    targets = [t for t in (niche.get("targets") or []) if isinstance(t, dict)]
    leads_cfg = ((body.get("automation") or {}).get("leads") or {}) if isinstance(body.get("automation"), dict) else {}
    # Parent industry of the niche ("IT" for "IT > AI Platform"), if the ERP sends it (dict or str).
    industry_raw = niche.get("industry") or niche.get("industryName") or body.get("industry") or ""
    industry = industry_raw.get("name") if isinstance(industry_raw, dict) else str(industry_raw or "")
    return CampaignConfig(
        campaign_id=str(body.get("campaignId") or body.get("id") or campaign_id),
        niche=str(niche.get("name") or body.get("nicheName") or ""),
        industry=str(industry or ""),
        niche_id=niche.get("id"),
        niche_slug=str(niche.get("slug") or ""),
        targets=targets,
        region=str(body.get("region") or ""),
        country=str(body.get("country") or ""),
        project=str(body.get("name") or body.get("project") or ""),
        default_regions=list(leads_cfg.get("defaultRegions") or []),
        max_leads_per_run=int(leads_cfg.get("maxLeadsPerRun") or 500),
    )


class ErpGateway(Protocol):
    def fetch_campaign_config(self, campaign_id: str) -> CampaignConfig: ...
    def post_prospects_bulk(self, campaign_id: str, prospects: list[dict]) -> dict: ...
    def post_run_callback(self, campaign_id: str, metrics: dict, status: str = "SUCCESS") -> dict: ...
    def trigger_niche_analytics(self, campaign_id: str) -> dict: ...


class ErpClient:
    def __init__(self, base_url: str, token: str, timeout: float = 60.0) -> None:
        import httpx

        self._http = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"x-arsenal-token": token}, timeout=timeout
        )

    def close(self) -> None:
        self._http.close()

    def fetch_campaign_config(self, campaign_id: str) -> CampaignConfig:
        r = self._http.get(f"/campaigns/{campaign_id}/config")
        r.raise_for_status()
        return to_config(campaign_id, r.json())

    def post_prospects_bulk(self, campaign_id: str, prospects: list[dict]) -> dict:
        r = self._http.post("/prospects/bulk", json={"campaignId": campaign_id, "prospects": prospects})
        r.raise_for_status()
        return r.json()

    def post_run_callback(self, campaign_id: str, metrics: dict, status: str = "SUCCESS") -> dict:
        payload = {"stage": "LEAD_SATELLITE", "status": status, "campaignId": campaign_id, "metrics": metrics}
        r = self._http.post("/arsenal/runs/callback", json=payload)
        r.raise_for_status()
        return r.json()

    def post_scrape_progress(self, aim_id: str, phase: str, current: int, total: int, label: str) -> None:
        # Live per-phase progress for the Reach UI countdown. Best-effort + short timeout:
        # this fires many times mid-scrape and must never slow or break the run.
        self._http.patch(
            f"/growth/reach/aims/{aim_id}/scrape-progress",
            json={"phase": phase, "current": current, "total": total, "label": label},
            timeout=5.0,
        )

    def trigger_niche_analytics(self, campaign_id: str) -> dict:
        # best-effort; the n8n gate POSTs to the niche-analytics webhook then throws
        r = self._http.post("/niche-analytics", json={"campaignId": campaign_id, "trigger": "satellite-gate"})
        return {"status": r.status_code}
