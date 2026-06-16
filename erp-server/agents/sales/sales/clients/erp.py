"""ERP gateway for Sales Agent — the data layer (replaces db.py), behind a Protocol for tests.

Mirrors the ERP machine calls in n8n workflow OUNbboRQNqch5USk (x-arsenal-token):
  GET  /personas?limit=50          (persona name + prompt)
  POST /meeting-analyses           (persist a rendered analysis; readai/manual source)
The n8n service webhooks (GET /personas, GET /meeting-analyses) just proxy the ERP — the ERP
UI can call those directly, so they aren't reproduced here.
"""
from __future__ import annotations

from typing import Protocol


def _unwrap(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "personas", "results"):
            if isinstance(data.get(key), list):
                return data[key]
        if data.get("id") or data.get("name"):
            return [data]
    return []


class ErpGateway(Protocol):
    def get_personas(self, limit: int = 50) -> list[dict]: ...
    def save_meeting_analysis(self, row: dict) -> dict: ...


class ErpClient:
    def __init__(self, base_url: str, token: str, timeout: float = 180.0) -> None:
        import httpx

        self._http = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"x-arsenal-token": token}, timeout=timeout
        )

    def close(self) -> None:
        self._http.close()

    def get_personas(self, limit: int = 50) -> list[dict]:
        r = self._http.get("/personas", params={"limit": limit})
        r.raise_for_status()
        return _unwrap(r.json())

    def save_meeting_analysis(self, row: dict) -> dict:
        r = self._http.post("/meeting-analyses", json=row)
        r.raise_for_status()
        return r.json()
