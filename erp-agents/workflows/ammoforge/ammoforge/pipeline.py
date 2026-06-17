"""AmmoForge core — the function the ERP route calls: run(settings, opts, erp) -> dict.

Faithful to n8n workflow rDLhY3sqi6U9xK6t (AMMO FORGE (PG) v2):
  GET /campaigns/:id/config -> research demand drivers (LLM) -> forge coldEmail + newsBrief
  (LLM, strict JSON, fail loud) -> POST /campaigns/:id/templates -> notify TEMPLATES_READY.

Dry-run (default): does the research+forge and returns the templates WITHOUT posting.
--live: posts the templates to the ERP and fires the notification.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients import llm
from .clients.erp import ErpGateway

TZ = "Europe/Berlin"


@dataclass(frozen=True)
class RunOptions:
    campaign_id: str
    live: bool = False
    # persist = write the forged templates to the ERP (campaigns.templates) so Reach can read
    # them. Distinct from any external side effect — ammoforge only ever writes to the ERP, so
    # 'persist' is the sole write gate. Dry-run can persist:true to materialize the chain safely.
    persist: bool = False
    use_llm: bool = True  # False => offline deterministic forge (tests / isolated)


def run(settings, opts: RunOptions, erp: ErpGateway) -> dict:
    run_id = "forge-" + datetime.now(ZoneInfo(TZ)).strftime("%Y-%m-%d-%H%M")
    mode = "live" if opts.live else "dry"
    result: dict = {"runId": run_id, "mode": mode, "campaignId": opts.campaign_id, "status": "ok"}

    if not opts.campaign_id:
        return {**result, "status": "error", "error": "campaignId is required"}

    cfg = erp.fetch_campaign_config(opts.campaign_id)
    result["name"] = cfg.name
    result["niche"] = cfg.niche

    try:
        if opts.use_llm:
            research = llm.research_demand_drivers(settings, cfg)
            forged = llm.forge_templates(settings, cfg, research)
        else:
            research = llm.offline_research(cfg)
            forged = llm.offline_forge(cfg, research)
    except ValueError as exc:  # parse-fail-loud from the forge step
        return {**result, "status": "error", "error": str(exc)}

    result["templates"] = forged.as_templates()
    result["posted"] = False
    result["notified"] = False

    if opts.persist:
        erp.post_templates(opts.campaign_id, forged.as_templates())
        result["posted"] = True
        try:
            erp.post_notification(
                "TEMPLATES_READY",
                f"Templates ready: {cfg.name}",
                "Cold email + reply templates generated",
                campaign_id=opts.campaign_id,
                link=f"/campaigns/{opts.campaign_id}",
            )
            result["notified"] = True
        except Exception:  # notification is best-effort (continueRegularOutput in n8n)
            pass

    return result
