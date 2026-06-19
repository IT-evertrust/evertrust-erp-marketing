"""HTTP surface for Reply Glock — the route the ERP calls.

client -> ERP route -> POST /glock/run -> run() -> structured output (counts + per-reply actions).
All gateways (ERP + Gmail/Calendar/LLM/WhatsApp) are injectable FastAPI deps so tests use fakes.

Run it: `uvicorn glock.server:app --port 8802`
"""
from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .cli import FixtureGmail
from .clients import calendar as calendar_mod
from .clients import gmail as gmail_mod
from .clients import llm as llm_mod
from .clients import whatsapp as whatsapp_mod
from .clients.erp import ErpClient, ErpGateway
from .pipeline import RunOptions, run
from .settings import Settings, load_settings, with_llm_override

# Where bare fixture names (e.g. "demo_replies.json") resolve to — the glock package dir.
FIXTURE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="EVERTRUST Reply Glock")

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
    # Optional: feed canned replies from a JSON file instead of Gmail (demo/sim, no
    # OAuth needed). Bare name resolves under the glock package dir, e.g. "demo_replies.json".
    fixture: str | None = None
    # Per-org LLM override from the ERP dispatch (AI Engine page). Each omitted field
    # falls back to the agent's own env default (request value ?? env).
    llmBaseUrl: str | None = None
    model: str | None = None
    apiKey: str | None = None


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
    # Fixture mode swaps Gmail for canned replies — lets the sim exercise the full
    # classify+route logic with zero credentials (sends/drafts are still live-gated).
    if req.fixture:
        p = Path(req.fixture)
        gmail = FixtureGmail(str(p if p.is_absolute() else FIXTURE_DIR / p))
    settings = with_llm_override(settings, req.llmBaseUrl, req.model, req.apiKey)
    opts = RunOptions(live=req.live, use_llm=req.useLlm, accounts=accounts)
    try:
        return run(settings, opts, erp, gmail, calendar, llm, whatsapp)
    finally:
        close = getattr(erp, "close", None)
        if callable(close):
            close()
