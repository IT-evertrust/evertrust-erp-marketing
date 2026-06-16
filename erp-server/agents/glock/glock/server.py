"""HTTP surface for Reply Glock — the route the ERP calls.

client -> ERP route -> POST /glock/run -> run() -> structured output (counts + per-reply actions).
All gateways (ERP + Gmail/Calendar/LLM/WhatsApp) are injectable FastAPI deps so tests use fakes.

Run it: `uvicorn glock.server:app --port 8803`
"""
from __future__ import annotations

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .clients import calendar as calendar_mod
from .clients import gmail as gmail_mod
from .clients import llm as llm_mod
from .clients import whatsapp as whatsapp_mod
from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings

app = FastAPI(title="EVERTRUST Reply Glock")


def get_settings() -> Settings:
    return load_settings()


def get_erp(settings: Settings = Depends(get_settings)) -> ErpGateway:
    return ErpClient(settings.erp_base_url, settings.arsenal_token)


def get_gmail():
    return gmail_mod


def get_calendar():
    return calendar_mod


def get_llm():
    return llm_mod


def get_whatsapp():
    return whatsapp_mod


class RunRequest(BaseModel):
    live: bool = False
    useLlm: bool = True
    accounts: list[str] | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "reply-glock"}


@app.post("/glock/run")
def glock_run(
    req: RunRequest,
    settings: Settings = Depends(get_settings),
    erp: ErpGateway = Depends(get_erp),
    gmail=Depends(get_gmail),
    calendar=Depends(get_calendar),
    llm=Depends(get_llm),
    whatsapp=Depends(get_whatsapp),
) -> dict:
    accounts = tuple(req.accounts) if req.accounts else ("info", "hanna")
    opts = RunOptions(live=req.live, use_llm=req.useLlm, accounts=accounts)
    try:
        return run(settings, opts, erp, gmail, calendar, llm, whatsapp)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
