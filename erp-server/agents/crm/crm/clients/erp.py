"""ERP gateway for CRM Customer — the data layer (replaces db.py), behind a Protocol for tests.

Mirrors the ERP machine calls in n8n workflow vNCqzVjOOhSD2Czb (x-arsenal-token):
  GET  /campaigns/machine/list?lifecycle=ACTIVE
  GET  /prospects?campaignId=&limit=500
  GET  /contracts?campaignId=&status=SIGNED&limit=200
  GET  /customers?limit=1000
  POST /hot-leads        (intake)
  POST /customers        (graduation)
Note: /customers + /hot-leads are flagged ASSUMED in the workflow sticky — confirm against the ERP.
"""
from __future__ import annotations

from typing import Protocol


def _unwrap(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "prospects", "contracts", "customers", "campaigns", "results"):
            if isinstance(data.get(key), list):
                return data[key]
        if data.get("id"):
            return [data]
    return []


class ErpGateway(Protocol):
    def list_active_campaigns(self) -> list[dict]: ...
    def get_prospects(self, campaign_id: str, limit: int = 500) -> list[dict]: ...
    def get_signed_contracts(self, campaign_id: str, limit: int = 200) -> list[dict]: ...
    def get_customers(self, limit: int = 1000) -> list[dict]: ...
    def upsert_hot_lead(self, row: dict) -> dict: ...
    def upsert_customer(self, row: dict) -> dict: ...


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
        out = []
        for c in _unwrap(r.json()):
            out.append({
                "campaignId": c.get("id") or c.get("campaignId") or c.get("_id"),
                "campaignName": c.get("name") or c.get("campaignName") or "",
                "niche": c.get("niche") or c.get("sector") or "",
            })
        return [c for c in out if c["campaignId"]]

    def get_prospects(self, campaign_id: str, limit: int = 500) -> list[dict]:
        r = self._http.get("/prospects", params={"campaignId": campaign_id, "limit": limit})
        r.raise_for_status()
        return _unwrap(r.json())

    def get_signed_contracts(self, campaign_id: str, limit: int = 200) -> list[dict]:
        r = self._http.get("/contracts", params={"campaignId": campaign_id, "status": "SIGNED", "limit": limit})
        r.raise_for_status()
        return _unwrap(r.json())

    def get_customers(self, limit: int = 1000) -> list[dict]:
        r = self._http.get("/customers", params={"limit": limit})
        r.raise_for_status()
        return _unwrap(r.json())

    def upsert_hot_lead(self, row: dict) -> dict:
        r = self._http.post("/hot-leads", json=row)
        r.raise_for_status()
        return r.json()

    def upsert_customer(self, row: dict) -> dict:
        r = self._http.post("/customers", json=row)
        r.raise_for_status()
        return r.json()
