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

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients import llm
from .clients.erp import ErpGateway
from .clients.search import SearchGateway, UrlFetcher
from .domain import filters, geo, tender
from .domain.models import Segment, build_segments, dedup_leads, leads_to_prospects
from .domain.scrape import hit_to_lead, queries_for_segment, registrable_domain, scrape_emails

TZ = "Europe/Berlin"

# The ERP ProspectInputDto fields (email required; rest optional). Our richer fields
# (companyType / status / score / ranking) are UI-only and not sent to the ERP.
_PROSPECT_FIELDS = ("email", "companyName", "contactName", "phone", "website", "city", "country",
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
    # region_focus: a ZONE word ("North"/"South"/"East"/"West"/"Border-DE"…) — a relative part of
    # the country, NOT a real place. It is never passed to geo.cities_for as a literal (that would
    # search a garbage term); instead it is fed to the LLM country profiler ("focus on the {zone} of
    # {country}") and treated like nationwide-within-zone (use the profiler's cities). Empty / None /
    # "Anywhere" => whole country (the normal nationwide path). Set by the Reach adapter only.
    region_focus: str | None = None


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

    # COUNTRY PROFILE (LLM) — the SINGLE source of geography for ANY country (driven by the AIM
    # country): its real regions + cities (local spelling), iso2/langCode, and BILINGUAL niche
    # keywords (local script + English). There are NO hardcoded country tables — discovery + the
    # niche gate work in the country's own language and find native-named firms. Needs a capable
    # model; with no LLM the run degrades to the country name as a single geo term.
    # A ZONE focus ("North"/"South"/…) narrows the profiler to a part of the country; it is NOT a
    # real place name, so it never reaches geo.cities_for as a literal. Empty / "Anywhere" => whole
    # country. The zone is resolved by the LLM profiler (which returns real cities in that zone).
    zone_focus = (opts.region_focus or "").strip()
    if zone_focus and geo.is_nationwide(zone_focus):
        zone_focus = ""
    profile = (
        llm.profile_country(settings, cfg.country, cfg.niche, cfg.industry, region_focus=zone_focus)
        if (opts.use_llm and settings.llm_base_url) else {}
    )
    if zone_focus:
        result["regionFocus"] = zone_focus
    iso2 = (profile.get("iso2") or "").lower()
    market_tld = ("." + iso2) if iso2 else ""
    if profile:
        result["profileCities"] = len(profile.get("cities") or [])
        result["profileRegions"] = len(profile.get("regions") or [])
        result["profileLang"] = profile.get("langCode") or ""

    country = cfg.country or ""
    base_seg = Segment(
        niche=(cfg.niche or "").upper(), city="", country=country, focus="tender",
        niche_target_id=cfg.niche_id, niche_target_name=cfg.niche or "",
        niche_target_phrase=cfg.niche, system_content="", user_content="",
    )

    # 1) BUZZWORDS — bilingual via the profiler (local + English) so the query set AND the niche gate
    #    speak the country's language; else a plain buzzword call, else the deterministic set.
    buzz = (profile.get("keywordsLocal", []) + profile.get("keywordsEnglish", [])) if profile else []
    if not buzz and opts.use_llm and settings.llm_base_url:
        buzz = llm.generate_buzzwords(settings, cfg.niche, country, cfg.industry)
    if not buzz:
        buzz = tender.fallback_buzzwords(cfg.niche)
    buzz = list(dict.fromkeys([b for b in buzz if b]))
    result["buzzwords"] = len(buzz)
    result["buzzList"] = buzz          # the AIM niche's own keywords — used to build the qualify ICP
    result["marketTld"] = market_tld   # exposed for the qualify geo gate

    lang = (profile.get("langCode") if profile else "") or ""
    result["searchLanguage"] = lang or "any"
    ntoks = filters.niche_tokens(cfg.niche, buzz)

    def _search(q):
        try:
            return search.query_paged(q, settings.search_pages, lang) if hasattr(search, "query_paged") \
                else search.query(q)
        except Exception:
            return []

    # 2) REGION BATCHES — "Anywhere" loops EVERY region of the AIM country (count = whatever the
    #    country has: 16 / 28 / 63…), one batch at a time with a cooldown, so each region gets its own
    #    query budget and the search backend isn't overloaded. A specific region/city list = 1 batch.
    # A ZONE focus is "nationwide within the zone": the profiler already returned only the zone's
    # cities, so use the profiler geography exactly as we do for "Anywhere" (never expand the zone
    # word as a literal via cities_for).
    use_profile_geo = geo.is_nationwide(cfg.region) or bool(zone_focus)
    region_batches = []
    if use_profile_geo:
        if profile.get("regions"):     # model gave real regions -> use them
            region_batches = [(str(r.get("name") or f"region {i + 1}"), list(r.get("cities") or []))
                              for i, r in enumerate(profile["regions"]) if r.get("cities")]
        elif profile.get("cities"):    # flat city list -> chunk into batches (reliable + still looped)
            cs, n = profile["cities"], max(1, settings.region_chunk)
            region_batches = [(f"batch {i // n + 1}", cs[i:i + n]) for i in range(0, len(cs), n)]
    if not region_batches:
        if use_profile_geo:
            # Anywhere / zone with no profiler geography (no LLM, or it failed): degrade to the
            # country as a single geo term. NEVER pass a zone word ("North") to cities_for — it
            # would be searched as a literal place. The zone already steered the (skipped) profiler.
            cities0 = [country] if country else []
        else:
            cities0 = geo.cities_for(cfg.country, cfg.region, cfg.default_regions) or ([country] if country else [])
        region_batches = [("all", cities0)]
    # max_regions caps how many region batches one run sweeps (bounds time + SearXNG load). 0 = no
    # cap = cover EVERY region the country has (paired with the per-region cooldown so it stays kind
    # to SearXNG). >0 truncates to that many regions, largest/first first.
    if settings.max_regions > 0:
        region_batches = region_batches[: settings.max_regions]

    # 3) DISCOVER one region's cities — queries (each carrying its city) -> search -> two gates
    #    (NICHE_BLOCK commercial-only + bilingual niche-relevance) -> domain-deduped candidates.
    def _discover(cities):
        segs = build_segments(replace(cfg, region=", ".join(cities))) if cities else []
        if opts.max_segments is not None:
            segs = segs[: opts.max_segments]
        plan = []
        for q, qcity in tender.build_tender_queries(buzz, cities, country, cap=settings.queries_per_region):
            plan.append({"q": q, "city": qcity, "ntId": base_seg.niche_target_id,
                         "ntName": base_seg.niche_target_name, "phrase": cfg.niche})
        for seg in segs:
            for q in queries_for_segment(seg):
                plan.append({"q": q, "city": seg.city, "ntId": seg.niche_target_id,
                             "ntName": seg.niche_target_name, "phrase": seg.niche_target_phrase})
        planq, qseen = [], set()
        for it in plan:
            k = (it["q"] or "").lower().strip()
            if k and k not in qseen:
                qseen.add(k)
                planq.append(it)
        planq = planq[: settings.queries_per_region]
        lm, ht, blk, off = {}, 0, 0, 0
        with ThreadPoolExecutor(max_workers=max(1, settings.search_workers)) as ex:
            for it, hits in zip(planq, ex.map(lambda x: _search(x["q"]), planq)):
                ht += len(hits)
                seg_for = Segment(
                    niche=(it["phrase"] or cfg.niche or "").upper(), city=it["city"], country=country,
                    focus="", niche_target_id=it["ntId"], niche_target_name=it["ntName"],
                    niche_target_phrase=it["phrase"] or cfg.niche, system_content="", user_content="",
                )
                for h in hits:
                    ld = hit_to_lead(h, seg_for)
                    if not ld:
                        continue
                    ld.source = "web"
                    ld.source_query = it["q"]
                    ld.segment = f"{seg_for.niche_target_name or seg_for.niche} @ {seg_for.city}".strip()
                    hay = f"{ld.name} {ld.snippet} {ld.website}"
                    if filters.is_blocked(hay):
                        blk += 1
                        continue
                    if not filters.mentions_niche(hay, ntoks):
                        off += 1
                        continue
                    key = registrable_domain(ld.website) or (ld.name or "").lower()
                    if key and key not in lm:
                        lm[key] = ld
        return segs, lm, ht, blk, off, len(planq)

    # 4) SWEEP regions until the target is met (or all regions done), cooling down between batches.
    pool, all_segments = {}, []
    hits_total = dropped_blocked = dropped_offniche = queries_run = regions_scanned = 0
    # Anywhere/nationwide + exhaust flag: keep sweeping ALL regions for full coverage instead of
    # stopping once lead_target is hit (a specific region/city list is one batch, unaffected).
    exhaust = use_profile_geo and settings.exhaust_anywhere_regions
    for _rname, rcities in region_batches:
        segs, lm, ht, blk, off, nq = _discover(rcities)
        all_segments.extend(segs)
        for k, v in lm.items():
            pool.setdefault(k, v)
        hits_total += ht
        dropped_blocked += blk
        dropped_offniche += off
        queries_run += nq
        regions_scanned += 1
        if len(pool) >= settings.lead_target and not exhaust:
            break
        if len(region_batches) > 1 and regions_scanned < len(region_batches) and settings.region_cooldown > 0:
            time.sleep(settings.region_cooldown)

    result["regionsPlanned"] = len(region_batches)
    result["regionsScanned"] = regions_scanned
    result["queriesRun"] = queries_run
    result["segmentsPlanned"] = len(all_segments)
    if not all_segments:
        return {**result, "status": "no_segments", "error": "missing niche or cities"}
    cities = list(dict.fromkeys([s.city for s in all_segments if s.city])) or [country]

    leads = list(pool.values())
    result["rawCandidates"] = len(leads)
    result["droppedBlocked"] = dropped_blocked
    result["droppedOffNiche"] = dropped_offniche

    # FALLBACK when discovery found nothing (offline tests, or a dead backend).
    if hits_total == 0:
        if opts.use_llm and settings.llm_base_url:
            leads = []
            for seg in all_segments:
                leads.extend(llm.research_leads(settings, seg, search))
        elif getattr(search, "offline", False):
            leads = []
            for seg in all_segments:
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
                 if tender.geo_relevant(ld.website, ld.name, ld.snippet, country, cities, market_tld)]
    if geo_leads:                 # prefer on-market leads; keep the raw set only if geo found none
        leads = geo_leads
    result["leadsFound"] = len(leads)

    # 5) CLASSIFY company type from the result text (cheap, no extra I/O).
    for ld in leads:
        ld.company_type = tender.classify_company_type(ld.name, ld.snippet, ld.source_url, ld.type)

    # 6) ENRICH — scrape candidate sites for a real, EVIDENCE-BASED email (concurrent). The address
    #    has to be present on a page we fetched; provenance (emailSourceUrl/Type/confidence) is set.
    result["emailsRecovered"] = (
        scrape_emails(leads, fetcher, settings.scrape_workers, settings.max_scrape)
        if settings.enable_web_email_recovery else 0)
    # LLM email recovery can output an address that was never on the page (a guess), so it is OFF by
    # default (allow_llm_email_recovery). When explicitly enabled it's the last mile after scraping.
    if opts.use_llm and settings.llm_base_url and settings.allow_llm_email_recovery:
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
                        leads[i].email = em
                        leads[i].status = ""
                        leads[i].email_source_type = "llm"   # flagged: lower-trust, no page evidence
                        leads[i].email_confidence = 0.5
            except Exception:
                pass

    # 7) SCORE + RANK — relevance score (reachable contact + on-niche + tender intent + on-market
    #    domain), then sort best-first and stamp a 1..N ranking.
    for ld in leads:
        verified = bool(ld.email and ld.status == "")
        ld.score = tender.score_lead(
            name=ld.name, snippet=ld.snippet, url=ld.website, country=ld.country or country,
            niche=cfg.niche, has_email=bool(ld.email), verified=verified, cities=cities,
            market_tld=market_tld)
    leads.sort(key=lambda l: l.score, reverse=True)

    prospects = leads_to_prospects(leads, settings.min_keep_score)

    # 7b) QUALITY STAGE (LLM-driven, niche/country-agnostic) — only when an LLM is available, so the
    #     offline/test path keeps its raw behaviour. Replaces the raw prospect list with QUALIFIED,
    #     on-niche, tiered companies AND mines on-niche directories/associations for their member
    #     companies (with a headless-render fallback for JS member lists). Same code as the local
    #     dev driver, so web runs match what we validate locally. Defensive: any failure leaves the
    #     raw prospects untouched.
    if opts.use_llm and settings.llm_base_url:
        from .clients.render import PlaywrightRenderer
        from .refine import refine_prospects
        renderer = PlaywrightRenderer()
        try:
            ref = refine_prospects(
                prospects, settings=settings, fetcher=fetcher, renderer=renderer,
                niche=cfg.niche, country=country, market_tld=market_tld, buzz=result.get("buzzList"))
            prospects = ref["qualified"]
            result["qualified"] = len(prospects)
            result["hubsMined"] = ref["hubsMined"]
            result["hubCompanies"] = ref["hubCompanies"]
            result["excludedByQualify"] = ref["excluded"]
        except Exception as e:  # noqa: BLE001 — never let the quality stage abort a run
            result["qualifyError"] = str(e)[:200]
        finally:
            renderer.close()

    # QUALITY FLOOR — drop tier C (score below settings.min_keep_score = noise). Keep B and above
    # only; the dropped count is reported so a sweep that yields all-C is visible.
    dropped_c = sum(1 for p in prospects if p.get("tier") == "C")
    prospects = [p for p in prospects if p.get("tier") != "C"]
    for i, p in enumerate(prospects):
        p["ranking"] = i + 1
    verified = sum(1 for p in prospects if p["emailVerified"])
    result["droppedTierC"] = dropped_c
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
            metrics = {"prospectsUpserted": upserted, "segmentsPlanned": len(all_segments)}
            result["metrics"] = metrics
            result["posted"] = True
            if opts.live:   # the run-completion callback is a live-only signal
                try:
                    erp.post_run_callback(opts.campaign_id, metrics)
                except Exception:
                    pass

    return result
