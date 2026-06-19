"""HTTP surface for AmmoForge — the route the ERP calls.

client -> ERP route -> POST /ammoforge/run {campaignId} -> run() -> structured output.
The ERP gateway is an injectable FastAPI dependency so tests override it with a fake.

Run it: `uvicorn ammoforge.server:app --port 8804`
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings, with_llm_override

app = FastAPI(title="EVERTRUST AmmoForge")

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


class RunRequest(BaseModel):
    campaignId: str
    live: bool = False
    persist: bool | None = None   # write templates to ERP; defaults to `live` when unset
    useLlm: bool = True
    # Per-org LLM override from the ERP dispatch (AI Engine page). Each omitted field
    # falls back to the agent's own env default (request value ?? env).
    llmBaseUrl: str | None = None
    model: str | None = None
    apiKey: str | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "ammoforge"}


@app.post("/ammoforge/run")
def ammoforge_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
) -> dict:
    persist = req.persist if req.persist is not None else req.live
    settings = with_llm_override(settings, req.llmBaseUrl, req.model, req.apiKey)
    opts = RunOptions(campaign_id=req.campaignId, live=req.live, persist=persist, use_llm=req.useLlm)
    try:
        return run(settings, opts, erp)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
