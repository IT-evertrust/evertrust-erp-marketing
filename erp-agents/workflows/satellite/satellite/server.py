"""HTTP surface for Satellite — the route the ERP calls.

client -> ERP route -> POST /satellite/run {campaignId} -> run() -> structured output.
ERP/search/fetcher gateways are injectable FastAPI deps so tests override them with fakes.

Run it: `uvicorn satellite.server:app --port 8801`
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clients.erp import ErpClient, ErpGateway
from .clients.search import HttpFetcher, SearchGateway, UrlFetcher, WebSearch
from .pipeline import RunOptions, run
from .settings import Settings, load_settings, with_llm_override

app = FastAPI(title="EVERTRUST Lead Satellite")

# Dev CORS: lets the local mock control panel (browser) POST here directly.
# Wide-open is fine for local dev; tighten allow_origins for any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_settings() -> Settings:
    return load_settings()


def get_erp(settings: Settings = Depends(get_settings)) -> ErpGateway:
    return ErpClient(settings.erp_base_url, settings.arsenal_token)


def get_search(settings: Settings = Depends(get_settings)) -> SearchGateway:
    # SearXNG if configured (auth via X-Search-Key = SEARXNG_API_KEY), otherwise DuckDuckGo.
    return WebSearch(settings.searxng_url, settings.searxng_api_key, pages=settings.ddg_pages)


def get_fetcher() -> UrlFetcher:
    return HttpFetcher()


class RunRequest(BaseModel):
    campaignId: str
    live: bool = False
    persist: bool | None = None   # write prospects to ERP; defaults to `live` when unset
    useLlm: bool = True
    maxSegments: int | None = None
    # Per-org LLM override from the ERP dispatch (AI Engine page). Each omitted field
    # falls back to the agent's own env default (request value ?? env).
    llmBaseUrl: str | None = None
    model: str | None = None
    apiKey: str | None = None


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
    persist = req.persist if req.persist is not None else req.live
    settings = with_llm_override(settings, req.llmBaseUrl, req.model, req.apiKey)
    opts = RunOptions(
        campaign_id=req.campaignId, live=req.live, persist=persist,
        use_llm=req.useLlm, max_segments=req.maxSegments,
    )
    try:
        return run(settings, opts, erp, search, fetcher)
    finally:
        for gw in (erp, search, fetcher):
            close = getattr(gw, "close", None)
            if callable(close):
                close()
