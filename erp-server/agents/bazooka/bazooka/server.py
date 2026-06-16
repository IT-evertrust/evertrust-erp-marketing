"""HTTP surface for reach — the 'route' the ERP backend calls.

Flow: client -> ERP route -> POST /reach/run here -> reach.run() -> structured output
relayed back to the client. The ERP gateway is a FastAPI dependency so tests override it
with a fake (no network, no live ERP needed).

Run it: `uvicorn bazooka.server:app --port 8800`  (the ERP posts to http://<host>:8800/reach/run)
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings

app = FastAPI(title="EVERTRUST Reach (Bazooka)")


def get_settings() -> Settings:
    return load_settings()


def get_erp(settings: Settings = Depends(get_settings)) -> ErpGateway:
    return ErpClient(settings.erp_base_url, settings.arsenal_token)


class RunRequest(BaseModel):
    live: bool = False
    campaign: str | None = None
    limit: int | None = None
    useLlm: bool = True


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "reach-bazooka"}


@app.post("/reach/run")
def reach_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
) -> dict:
    opts = RunOptions(
        live=req.live, campaign=req.campaign, limit=req.limit, use_llm=req.useLlm
    )
    try:
        return run(settings, opts, erp)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
