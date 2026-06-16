"""HTTP surface for AmmoForge — the route the ERP calls.

client -> ERP route -> POST /ammoforge/run {campaignId} -> run() -> structured output.
The ERP gateway is an injectable FastAPI dependency so tests override it with a fake.

Run it: `uvicorn ammoforge.server:app --port 8801`
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings

app = FastAPI(title="EVERTRUST AmmoForge")


def get_settings() -> Settings:
    return load_settings()


def get_erp(settings: Settings = Depends(get_settings)) -> ErpGateway:
    return ErpClient(settings.erp_base_url, settings.arsenal_token)


class RunRequest(BaseModel):
    campaignId: str
    live: bool = False
    useLlm: bool = True


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "ammoforge"}


@app.post("/ammoforge/run")
def ammoforge_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
) -> dict:
    opts = RunOptions(campaign_id=req.campaignId, live=req.live, use_llm=req.useLlm)
    try:
        return run(settings, opts, erp)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
