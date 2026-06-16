"""HTTP surface for Satellite — the route the ERP calls.

client -> ERP route -> POST /satellite/run {campaignId} -> run() -> structured output.
ERP/search/fetcher gateways are injectable FastAPI deps so tests override them with fakes.

Run it: `uvicorn satellite.server:app --port 8802`
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .clients.erp import ErpClient, ErpGateway
from .clients.search import HttpFetcher, SearxngClient, UrlFetcher, SearchGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings

app = FastAPI(title="EVERTRUST Lead Satellite")


def get_settings() -> Settings:
    return load_settings()


def get_erp(settings: Settings = Depends(get_settings)) -> ErpGateway:
    return ErpClient(settings.erp_base_url, settings.arsenal_token)


def get_search(settings: Settings = Depends(get_settings)) -> SearchGateway:
    return SearxngClient(settings.searxng_url, settings.arsenal_token)


def get_fetcher() -> UrlFetcher:
    return HttpFetcher()


class RunRequest(BaseModel):
    campaignId: str
    live: bool = False
    useLlm: bool = True
    maxSegments: int | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "lead-satellite"}


@app.post("/satellite/run")
def satellite_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
    search: SearchGateway = Depends(get_search),
    fetcher: UrlFetcher = Depends(get_fetcher),
) -> dict:
    opts = RunOptions(
        campaign_id=req.campaignId, live=req.live, use_llm=req.useLlm, max_segments=req.maxSegments
    )
    try:
        return run(settings, opts, erp, search, fetcher)
    finally:
        for gw in (erp, search, fetcher):
            close = getattr(gw, "close", None)
            if callable(close):
                close()
