"""ERP gateway for ContractMaker — the data layer (replaces db.py), behind a Protocol for tests.

Mirrors the ERP machine calls in n8n workflow wZWcjzx7fSbbsT7c (x-arsenal-token):
  GET   /campaigns/machine/list?lifecycle=ACTIVE      (resolve campaign by country+niche)
  GET   /contracts?leadId=&campaignId=&limit=1        (idempotency)
  POST  /contracts                                    (status GENERATED + drive file)
  PATCH /contracts/:id                                (status SIGNED)
"""
from __future__ import annotations

from typing import Protocol


def _unwrap(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "contracts", "campaigns", "results"):
            if isinstance(data.get(key), list):
                return data[key]
        if data.get("id"):
            return [data]
    return []


def _g(c: dict, *keys):
    for k in keys:
        if c.get(k) not in (None, ""):
            return c[k]
        cfg = c.get("config") or c.get("machineConfig") or {}
        if isinstance(cfg, dict) and cfg.get(k) not in (None, ""):
            return cfg[k]
    return ""


class ErpGateway(Protocol):
    def list_active_campaigns(self) -> list[dict]: ...
    def get_contracts(self, lead_id: str, campaign_id: str, limit: int = 1) -> list[dict]: ...
    def record_contract(self, payload: dict) -> dict: ...
    def mark_signed(self, contract_id: str, payload: dict) -> dict: ...


class ErpClient:
    def __init__(self, base_url: str, token: str, timeout: float = 120.0) -> None:
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
                "id": _g(c, "id", "campaignId", "_id"),
                "niche": _g(c, "niche", "sector"),
                "country": _g(c, "country"),
                "folderId": _g(c, "driveFolderId", "folderId", "campaignFolderId", "contractFolderId"),
                "templateAssetId": _g(c, "templateAssetId", "templateId", "contractTemplateAssetId"),
            })
        return [c for c in out if c["id"]]

    def get_contracts(self, lead_id: str, campaign_id: str, limit: int = 1) -> list[dict]:
        params = {"limit": limit}
        if lead_id:
            params["leadId"] = lead_id
        if campaign_id:
            params["campaignId"] = campaign_id
        r = self._http.get("/contracts", params=params)
        if r.status_code >= 400:
            return []
        return _unwrap(r.json())

    def record_contract(self, payload: dict) -> dict:
        r = self._http.post("/contracts", json=payload)
        r.raise_for_status()
        return r.json()

    def mark_signed(self, contract_id: str, payload: dict) -> dict:
        r = self._http.patch(f"/contracts/{contract_id}", json=payload)
        r.raise_for_status()
        return r.json()
