"""HTTP surface for Satellite — the route the ERP's "run lead" button calls.

ERP ArsenalService -> POST {AGENT_LEAD_SATELLITE_URL}/satellite/run {campaignId, live:true} -> here.
The ERP fires this with a 120s timeout and only records the HAND-OFF (DISPATCHED on a 2xx), so a
real run (LLM + search + scrape, minutes long) must NOT block the response: by default we accept
the request, return 2xx immediately, run the pipeline in the BACKGROUND, and the pipeline posts its
own /arsenal/runs/callback when done. Pass `wait:true` to run synchronously and get the full result
(used by the CLI/tests). ERP/search/fetcher gateways are injectable FastAPI deps so tests fake them.

Run it: `uvicorn satellite.server:app --port 8801`
"""
from __future__ import annotations

from fastapi import BackgroundTasks, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clients.erp import ErpClient, ErpGateway
from .clients.search import HttpFetcher, SearchGateway, UrlFetcher, WebSearch
from .pipeline import RunOptions, run
from .settings import Settings, load_settings, with_llm_override, with_scraper_override

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
    # SearXNG-first (auth via X-Search-Key = SEARXNG_API_KEY); DDG only as an opt-in fallback.
    return WebSearch(settings.searxng_url, settings.searxng_api_key,
                     pages=settings.ddg_pages, enable_ddg=settings.enable_ddg_fallback)


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
    # Per-org Lead Scraper tuning from the ERP dispatch (Configuration page). Each omitted
    # field falls back to the agent's own env default (request value ?? env).
    leadTarget: int | None = None
    maxQueries: int | None = None
    minScore: int | None = None
    # False (default = the ERP fire-and-forget): dispatch in the background, return 2xx immediately,
    # post the run callback when done. True: run synchronously and return the full result (CLI/tests).
    wait: bool = False


def _close_all(*gateways) -> None:
    for gw in gateways:
        close = getattr(gw, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass


def _run_bg(settings, opts, erp, search, fetcher) -> None:
    """Background worker: run the full pipeline (which posts /arsenal/runs/callback at the end),
    then close the gateways. Errors are swallowed — the ERP already recorded the dispatch."""
    try:
        run(settings, opts, erp, search, fetcher)
    except Exception:
        pass
    finally:
        _close_all(erp, search, fetcher)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "lead-satellite"}


@app.post("/satellite/run")
def satellite_run(
    req: RunRequest,
    background_tasks: BackgroundTasks,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
    search: SearchGateway = Depends(get_search),
    fetcher: UrlFetcher = Depends(get_fetcher),
) -> dict:
    persist = req.persist if req.persist is not None else req.live
    settings = with_llm_override(settings, req.llmBaseUrl, req.model, req.apiKey)
    settings = with_scraper_override(settings, req.leadTarget, req.maxQueries, req.minScore)
    opts = RunOptions(
        campaign_id=req.campaignId, live=req.live, persist=persist,
        use_llm=req.useLlm, max_segments=req.maxSegments,
    )
    if req.wait:
        try:
            return run(settings, opts, erp, search, fetcher)
        finally:
            _close_all(erp, search, fetcher)
    # Fire-and-forget (the ERP path): return the hand-off now, do the work in the background so the
    # ERP's 120s POST doesn't time out. The pipeline posts /arsenal/runs/callback when it finishes.
    background_tasks.add_task(_run_bg, settings, opts, erp, search, fetcher)
    return {"status": "dispatched", "campaignId": req.campaignId,
            "mode": "live" if req.live else "dry"}
