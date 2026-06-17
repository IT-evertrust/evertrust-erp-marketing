"""HTTP surface for RAG Agent — the route the ERP calls.

client -> ERP route -> POST /rag/run -> run() -> structured output (drafted/saved counts).
ERP + LLM gateways injectable so tests use fakes.

Run it: `uvicorn rag.server:app --port 8806`
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clients import llm as llm_mod
from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings

app = FastAPI(title="EVERTRUST RAG Agent")

# Dev CORS: lets the local mock control panel (browser) POST here directly.
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


def get_llm():
    return llm_mod


class RunRequest(BaseModel):
    live: bool = False
    useLlm: bool = True
    limit: int = 50


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "rag-agent"}


@app.post("/rag/run")
def rag_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
    llm=Depends(get_llm),
) -> dict:
    opts = RunOptions(live=req.live, use_llm=req.useLlm, limit=req.limit)
    try:
        return run(settings, opts, erp, llm)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
