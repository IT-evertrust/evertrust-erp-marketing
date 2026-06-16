"""HTTP surface for CRM Customer — the route the ERP calls.

client -> ERP route -> POST /crm/run -> run() -> structured output (intake + graduation).
ERP gateway injectable so tests use a fake.

Run it: `uvicorn crm.server:app --port 8805`
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings

app = FastAPI(title="EVERTRUST CRM Customer")


def get_settings() -> Settings:
    return load_settings()


def get_erp(settings: Settings = Depends(get_settings)) -> ErpGateway:
    return ErpClient(settings.erp_base_url, settings.arsenal_token)


class RunRequest(BaseModel):
    live: bool = False


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "crm-customer"}


@app.post("/crm/run")
def crm_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
) -> dict:
    try:
        return run(settings, RunOptions(live=req.live), erp)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
