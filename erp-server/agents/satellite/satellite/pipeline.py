"""Satellite core — the function the ERP route calls: run(settings, opts, erp, search, fetcher).

Faithful to n8n workflow dCGzrlpaxpxJanbJ (LEAD SATELLITE copy 6 (PG)), with the n8n fan-out/
Data-Table machinery collapsed into a bounded loop:
  GET /campaigns/:id/config -> niche gate (targets required) -> build segments (targets x cities
  x foci, capped) -> per-segment lead research (LLM + web_search) -> dedup -> email recovery
  (LLM web search + website/Cloudflare decode) -> POST /prospects/bulk -> run callback.

Dry-run (default): research + build prospects, NO ERP writes. --live: bulk-post + callback.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients import llm
from .clients.erp import ErpGateway
from .clients.search import SearchGateway, UrlFetcher
from .domain.models import (
    build_segments,
    dedup_leads,
    extract_emails_from_html,
    leads_to_prospects,
)

TZ = "Europe/Berlin"
_SCRAPE_PATHS = ["", "/kontakt", "/contact", "/contacts", "/impressum", "/about"]
_SCRAPE_MAX_ROWS = 25


@dataclass(frozen=True)
class RunOptions:
    campaign_id: str
    live: bool = False
    use_llm: bool = True
    max_segments: int | None = None  # cap segments this run (testing / training wheels)


def _recover_via_website(leads, fetcher: UrlFetcher) -> int:
    recovered = 0
    scanned = 0
    for ld in leads:
        if scanned >= _SCRAPE_MAX_ROWS:
            break
        if ld.email or not ld.website:
            continue
        scanned += 1
        base = ld.website if "://" in ld.website else "https://" + ld.website
        base = base.rstrip("/")
        dom = base.split("://", 1)[-1].replace("www.", "").split("/")[0]
        for path in _SCRAPE_PATHS:
            html = fetcher.get(base + path)
            email = extract_emails_from_html(html, dom) if html else ""
            if email:
                ld.email, ld.status = email, ""
                recovered += 1
                break
    return recovered


def run(settings, opts: RunOptions, erp: ErpGateway, search: SearchGateway, fetcher: UrlFetcher) -> dict:
    run_id = "wf3-" + datetime.now(ZoneInfo(TZ)).strftime("%Y%m%d%H%M%S")
    mode = "live" if opts.live else "dry"
    result: dict = {"runId": run_id, "mode": mode, "campaignId": opts.campaign_id, "status": "ok"}

    if not opts.campaign_id:
        return {**result, "status": "error", "error": "campaignId is required"}

    cfg = erp.fetch_campaign_config(opts.campaign_id)
    result["niche"] = cfg.niche

    # Niche gate: targets must exist (NICHE ANALYTICS populates them).
    if not cfg.targets:
        try:
            erp.trigger_niche_analytics(opts.campaign_id)
        except Exception:
            pass
        return {**result, "status": "no_targets",
                "error": "niche has no targets — NICHE ANALYTICS triggered; retry when ready"}

    segments = build_segments(cfg)
    if opts.max_segments is not None:
        segments = segments[: opts.max_segments]
    result["segmentsPlanned"] = len(segments)
    if not segments:
        return {**result, "status": "no_segments", "error": "missing niche or cities"}

    leads = []
    for seg in segments:
        leads.extend(llm.research_leads(settings, seg, search) if opts.use_llm else llm.offline_research(seg))
    leads = dedup_leads(leads)
    result["leadsFound"] = len(leads)

    # Email recovery: LLM web-search for missing, then website/Cloudflare-decode scrape.
    if opts.use_llm:
        missing = [{"id": i, "name": ld.name, "website": ld.website, "city": ld.city, "country": ld.country}
                   for i, ld in enumerate(leads) if not ld.email]
        if missing:
            got = llm.recover_emails(settings, missing[:600], search)
            for i, em in got.items():
                if 0 <= i < len(leads) and not leads[i].email:
                    leads[i].email, leads[i].status = em, ""
    result["emailsRecovered"] = _recover_via_website(leads, fetcher)

    prospects = leads_to_prospects(leads)
    verified = sum(1 for p in prospects if p["emailVerified"])
    result["prospects"] = len(prospects)
    result["verified"] = verified
    result["posted"] = False

    if opts.live:
        bulk = erp.post_prospects_bulk(opts.campaign_id, prospects)
        data = bulk.get("data", bulk) if isinstance(bulk, dict) else {}
        created = int(data.get("created") or data.get("inserted") or 0)
        updated = int(data.get("updated") or data.get("upserted") or 0)
        upserted = (created + updated) if (created or updated) else len(prospects)
        metrics = {"prospectsUpserted": upserted, "segmentsPlanned": len(segments)}
        result["metrics"] = metrics
        result["posted"] = True
        try:
            erp.post_run_callback(opts.campaign_id, metrics)
        except Exception:
            pass

    return result
