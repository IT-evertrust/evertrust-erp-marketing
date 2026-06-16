"""CRM Customer core — the function the ERP route calls: run(settings, opts, erp) -> dict.

Faithful to n8n workflow vNCqzVjOOhSD2Czb (CRM Customer (PG)): for each active campaign pull
prospects + signed contracts (+ all customers once), then INTAKE Interested/Meeting prospects to
hot-leads and GRADUATE signed-but-not-yet-customer companies to customers.

Dry-run (default): compute the rows, NO ERP writes. --live: POST /hot-leads + POST /customers.
Pure ERP agent — no LLM, no Gmail.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .clients.erp import ErpGateway
from .domain.models import Campaign, compute_rows, signed_keys_from


@dataclass(frozen=True)
class RunOptions:
    live: bool = False


def _customer_emails(customers: list[dict]) -> set[str]:
    out = set()
    for c in customers:
        e = str(c.get("email") or c.get("Email") or "").strip().lower()
        if e:
            out.add(e)
    return out


def run(settings, opts: RunOptions, erp: ErpGateway) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    result: dict = {"runId": run_id, "mode": "live" if opts.live else "dry", "status": "ok"}

    raw_campaigns = erp.list_active_campaigns()
    customer_emails = _customer_emails(erp.get_customers())

    campaigns: list[Campaign] = []
    for c in raw_campaigns:
        cid = c["campaignId"]
        try:
            prospects = erp.get_prospects(cid)
        except Exception:
            prospects = []
        try:
            contracts = erp.get_signed_contracts(cid)
        except Exception:
            contracts = []
        campaigns.append(Campaign(
            campaign_id=cid, campaign_name=c.get("campaignName", ""), niche=c.get("niche", ""),
            prospects=prospects, signed_keys=signed_keys_from(contracts),
        ))

    rows = compute_rows(campaigns, customer_emails, now_iso)
    hot = [r for r in rows if r["_t"] == "hot"]
    cust = [r for r in rows if r["_t"] == "cust"]

    posted = 0
    if opts.live:
        for r in hot:
            try:
                erp.upsert_hot_lead({k: v for k, v in r.items() if k != "_t"})
                posted += 1
            except Exception:
                pass
        for r in cust:
            try:
                erp.upsert_customer({k: v for k, v in r.items() if k != "_t"})
                posted += 1
            except Exception:
                pass

    result["campaigns"] = len(campaigns)
    result["counts"] = {"hotLeads": len(hot), "customers": len(cust)}
    result["posted"] = posted if opts.live else 0
    result["hotLeads"] = [{"email": r["email"], "company": r["companyName"], "reason": r["hotReason"]} for r in hot]
    result["customers"] = [{"email": r["email"], "company": r["companyName"]} for r in cust]
    return result
