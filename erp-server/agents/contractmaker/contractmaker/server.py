"""HTTP surface for ContractMaker — the route the ERP calls (replaces the Read.ai webhook).

client / Read.ai -> ERP route -> POST /contractmaker/run {meeting:{...}} -> run() -> output.
ERP + LLM + gdocs gateways injectable so tests use fakes.

Run it: `uvicorn contractmaker.server:app --port 8807`
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .clients import gdocs as gdocs_mod
from .clients import llm as llm_mod
from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings

app = FastAPI(title="EVERTRUST ContractMaker")


def get_settings() -> Settings:
    return load_settings()


def get_erp(settings: Settings = Depends(get_settings)) -> ErpGateway:
    return ErpClient(settings.erp_base_url, settings.arsenal_token)


def get_llm():
    return llm_mod


def get_gdocs():
    return gdocs_mod


class RunRequest(BaseModel):
    meeting: dict[str, Any] = {}
    live: bool = False
    useLlm: bool = True


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "contractmaker"}


@app.post("/contractmaker/run")
def contractmaker_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
    llm=Depends(get_llm),
    gdocs=Depends(get_gdocs),
) -> dict:
    opts = RunOptions(meeting=req.meeting, live=req.live, use_llm=req.useLlm)
    try:
        return run(settings, opts, erp, llm, gdocs)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
