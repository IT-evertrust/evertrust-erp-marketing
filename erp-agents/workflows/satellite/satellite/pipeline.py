"""Satellite core — the function the ERP route calls: run(settings, opts, erp, search, fetcher).

A real keyless lead scraper (was: LLM invents a couple leads from one snippet). Flow:
  GET /campaigns/:id/config -> niche gate (targets required) -> build segments (targets x cities
  x foci) -> DISCOVER (several web-search queries per segment, run concurrently, hits turned
  straight into company candidates) -> dedup -> ENRICH (concurrent site-scrape for emails,
  + optional LLM recovery if a gateway is configured) -> POST /prospects/bulk -> run callback.

When no search backend is reachable (offline / tests), it falls back to the deterministic
offline path so --no-llm and the unit tests keep working.

Dry-run (default): research + build prospects, NO ERP writes. --live: bulk-post + callback.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients import llm
from .clients.erp import ErpGateway
from .clients.search import SearchGateway, UrlFetcher
from .domain import tender
from .domain.models import Segment, build_segments, dedup_leads, leads_to_prospects
from .domain.scrape import hit_to_lead, queries_for_segment, registrable_domain, scrape_emails

TZ = "Europe/Berlin"

# The ERP ProspectInputDto fields (email required; rest optional). Our richer fields
# (companyType / status / score / ranking) are UI-only and not sent to the ERP.
_PROSPECT_FIELDS = ("email", "companyName", "website", "city", "country",
                    "sourceUrl", "nicheTargetId", "emailVerified")


@dataclass(frozen=True)
class RunOptions:
    campaign_id: str
    live: bool = False
    # persist = write the scraped prospects to the ERP (POST /prospects/bulk) so Reach's send
    # list is populated. Distinct from `live` (which here also means the run callback). Dry-run
    # can persist:true to materialize the chain without external side effects.
    persist: bool = False
    use_llm: bool = True
    max_segments: int | None = None  # cap segments this run (testing / training wheels)


def run(settings, opts: RunOptions, erp: ErpGateway, search: SearchGateway, fetcher: UrlFetcher) -> dict:
    run_id = "wf3-" + datetime.now(ZoneInfo(TZ)).strftime("%Y%m%d%H%M%S")
    mode = "live" if opts.live else "dry"
    result: dict = {"runId": run_id, "mode": mode, "campaignId": opts.campaign_id, "status": "ok"}

    if not opts.campaign_id:
        return {**result, "status": "error", "error": "campaignId is required"}

    cfg = erp.fetch_campaign_config(opts.campaign_id)
    result["niche"] = cfg.niche
    result["nicheTargets"] = len(cfg.targets or [])

    # No curated targets yet? Don't block — scrape using the niche name itself (build_segments
    # falls back to a niche-as-target), and kick off NICHE ANALYTICS best-effort so future runs
    # get richer per-target segments. (Was a hard gate that returned 'no_targets'.)
    if not cfg.targets:
        result["nicheFallback"] = True
        try:
            erp.trigger_niche_analytics(opts.campaign_id)
            result["nicheAnalyticsTriggered"] = True
        except Exception:
            result["nicheAnalyticsTriggered"] = False

    segments = build_segments(cfg)
    if opts.max_segments is not None:
        segments = segments[: opts.max_segments]
    result["segmentsPlanned"] = len(segments)
    if not segments:
        return {**result, "status": "no_segments", "error": "missing niche or cities"}

    country = cfg.country or (segments[0].country if segments else "Germany")
    cities = list(dict.fromkeys([s.city for s in segments if s.city])) or [country]
    nt_id = segments[0].niche_target_id if segments else cfg.niche_id
    nt_name = segments[0].niche_target_name if segments else cfg.niche
    base_seg = Segment(
        niche=(cfg.niche or "").upper(), city="", country=country, focus="tender",
        niche_target_id=nt_id, niche_target_name=nt_name or cfg.niche,
        niche_target_phrase=cfg.niche, system_content="", user_content="",
    )

    # 1) BUZZWORDS — expand the niche into many tender-relevant search terms (LLM-enhanced,
    #    deterministic fallback) so discovery hunts the whole niche, not just the bare phrase.
    buzz = llm.generate_buzzwords(settings, cfg.niche, country) if (opts.use_llm and settings.llm_base_url) else []
    if not buzz:
        buzz = tender.fallback_buzzwords(cfg.niche)
    result["buzzwords"] = len(buzz)

    # 2) BUILD QUERY SET — buzzwords x tender/contact modifiers x geography, plus the per-segment
    #    seed queries, deduped and capped. This is the lead-count multiplier.
    seed = [q for seg in segments for q in queries_for_segment(seg)]
    tender_q = tender.build_tender_queries(buzz, cities, country, cap=settings.max_queries)
    allq, seen = [], set()
    for q in tender_q + seed:
        k = (q or "").lower().strip()
        if k and k not in seen:
            seen.add(k)
            allq.append(q)
    allq = allq[: settings.max_queries]
    result["queriesRun"] = len(allq)

    # 3) DISCOVER — run every query (paginated) concurrently; each real company URL becomes a
    #    candidate, deduped by domain as we go so we exhaust the search space toward the target.
    lang = tender.LANG_BY_COUNTRY.get(country, "")
    result["searchLanguage"] = lang or "any"

    def _search(q):
        try:
            return search.query_paged(q, settings.search_pages, lang) if hasattr(search, "query_paged") \
                else search.query(q)
        except Exception:
            return []

    leads_map: dict = {}
    hits_total = 0
    with ThreadPoolExecutor(max_workers=max(1, settings.search_workers)) as ex:
        for hits in ex.map(_search, allq):
            hits_total += len(hits)
            for h in hits:
                ld = hit_to_lead(h, base_seg)
                if not ld:
                    continue
                key = registrable_domain(ld.website) or (ld.name or "").lower()
                if key and key not in leads_map:
                    leads_map[key] = ld
    leads = list(leads_map.values())
    result["rawCandidates"] = len(leads)

    # FALLBACK when discovery found nothing (offline tests, or a dead backend).
    if hits_total == 0:
        if opts.use_llm and settings.llm_base_url:
            leads = []
            for seg in segments:
                leads.extend(llm.research_leads(settings, seg, search))
        elif getattr(search, "offline", False):
            leads = []
            for seg in segments:
                leads.extend(llm.offline_research(seg))
        else:
            return {**result, "status": "search_unavailable", "leadsFound": 0,
                    "rawCandidates": 0, "prospects": 0, "verified": 0, "posted": False,
                    "buzzwords": result.get("buzzwords", 0),
                    "error": "web search returned no results (rate-limited or unreachable); "
                             "retry shortly, or set SEARXNG_URL for unthrottled search"}

    leads = dedup_leads(leads)
    result["rawDeduped"] = len(leads)

    # 4) GEO FILTER — drop global off-market noise (Asia/US marketplaces etc.); keep the
    #    EU/DACH-relevant companies. Fall back to the full set only if filtering leaves too few.
    geo_leads = [ld for ld in leads
                 if tender.geo_relevant(ld.website, ld.name, ld.snippet, country, cities)]
    if geo_leads:                 # prefer on-market leads; keep the raw set only if geo found none
        leads = geo_leads
    result["leadsFound"] = len(leads)

    # 5) CLASSIFY company type from the result text (cheap, no extra I/O).
    for ld in leads:
        ld.company_type = tender.classify_company_type(ld.name, ld.snippet, ld.source_url, ld.type)

    # 6) ENRICH — scrape candidate sites for a real email (concurrent), then optional LLM recovery.
    result["emailsRecovered"] = scrape_emails(leads, fetcher, settings.scrape_workers, settings.max_scrape)
    if opts.use_llm and settings.llm_base_url:
        # LLM email recovery is the slow, optional last mile — site-scraping above is primary.
        # Cap hard: sending hundreds of companies in one prompt stalls the model. Prioritize
        # the highest-ranked email-less leads (they sort first after scoring below... but we
        # haven't scored yet, so take the first N which are already domain-deduped).
        missing = [{"id": i, "name": ld.name, "website": ld.website, "city": ld.city, "country": ld.country}
                   for i, ld in enumerate(leads) if not ld.email][:40]
        if missing:
            try:
                got = llm.recover_emails(settings, missing, search)
                for i, em in got.items():
                    if 0 <= i < len(leads) and not leads[i].email:
                        leads[i].email, leads[i].status = em, ""
            except Exception:
                pass

    # 7) SCORE + RANK — relevance score (reachable contact + on-niche + tender intent + on-market
    #    domain), then sort best-first and stamp a 1..N ranking.
    for ld in leads:
        verified = bool(ld.email and ld.status == "")
        ld.score = tender.score_lead(
            name=ld.name, snippet=ld.snippet, url=ld.website, country=ld.country or country,
            niche=cfg.niche, has_email=bool(ld.email), verified=verified, cities=cities)
    leads.sort(key=lambda l: l.score, reverse=True)

    prospects = leads_to_prospects(leads)
    for i, p in enumerate(prospects):
        p["ranking"] = i + 1
    verified = sum(1 for p in prospects if p["emailVerified"])
    result["prospects"] = len(prospects)
    result["verified"] = verified
    result["targetMet"] = len(prospects) >= settings.lead_target
    result["leads"] = prospects   # the actual scraped rows, for the mock-ui leads sidebar
    result["posted"] = False

    # Only CONTACTABLE prospects (a valid email) go to the ERP — the ProspectInputDto requires
    # email, and the prospects table is the outreach queue. The full ranked list (incl. no-email)
    # is still returned to the UI via result["leads"].
    if opts.persist:
        postable = [{k: p[k] for k in _PROSPECT_FIELDS if k in p and p[k] not in (None, "")}
                    for p in prospects if p.get("email")]
        result["postable"] = len(postable)
        if postable:
            bulk = erp.post_prospects_bulk(opts.campaign_id, postable)
            data = bulk.get("data", bulk) if isinstance(bulk, dict) else {}
            created = int(data.get("created") or data.get("inserted") or 0)
            updated = int(data.get("updated") or data.get("upserted") or 0)
            upserted = (created + updated) if (created or updated) else len(postable)
            metrics = {"prospectsUpserted": upserted, "segmentsPlanned": len(segments)}
            result["metrics"] = metrics
            result["posted"] = True
            if opts.live:   # the run-completion callback is a live-only signal
                try:
                    erp.post_run_callback(opts.campaign_id, metrics)
                except Exception:
                    pass

    return result
