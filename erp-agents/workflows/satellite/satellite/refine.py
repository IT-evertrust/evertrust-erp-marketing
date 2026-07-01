"""Quality stage for LEAD SATELLITE — shared by the production pipeline AND the local dev driver.

After discovery + email enrichment produce raw prospects, this turns them into TIERED, ON-NICHE,
real-company leads and MINES industry directories/associations for their member companies:

    prospects -> qualify (entity/niche/geo/tier gate) -> expand hubs (mine member companies,
                 JS-render fallback) -> re-qualify the harvested members -> merged ranked leads

Everything is niche- and country-agnostic: the ICP is built from the AIM niche's own keywords, the
entity/niche judgement is an LLM reading each page in its own language, and hub mining follows links
out of pages the agent itself classified as on-niche directories — no site, niche or country is
hardcoded. Keeping this in one module means `pipeline.run` (the web/ERP path) and `_run_niche.py`
(the local CSV harness) behave identically.
"""
from __future__ import annotations

from dataclasses import replace

from .clients import llm
from .domain.hubs import harvest_company_links
from .domain.icp import build_icp
from .domain.models import Lead, leads_to_prospects
from .domain.scrape import registrable_domain, scrape_emails
from .qualify import qualify


def make_classifier(settings, niche: str, country: str, *, fast_model: str = "hermes3:8b",
                    heavy_timeout: float = 45.0, fast_timeout: float = 30.0):
    """Resilient per-company classifier for qualify(): the configured heavy model first; after 3
    consecutive misses, degrade to a lighter/faster model ON THE SAME HOST (settings.llm_base_url —
    never a dev laptop). Returns None when no LLM is configured (qualify then uses the rule path)."""
    if not settings.llm_base_url:
        return None
    s_fast = replace(settings, lead_model=fast_model)
    cb = {"heavy_dead": False, "fails": 0}

    def classify(name, url, text):
        if not cb["heavy_dead"]:
            r = llm.classify_company(settings, name, url, text, niche, country, timeout=heavy_timeout)
            if r:
                cb["fails"] = 0
                return r
            cb["fails"] += 1
            if cb["fails"] >= 3:
                cb["heavy_dead"] = True   # heavy model flaky/slow -> faster model on the Mac for the rest
        return llm.classify_company(s_fast, name, url, text, niche, country, timeout=fast_timeout)

    return classify


def expand_via_hubs(buckets, fetcher, seen_domains, *, country, renderer=None,
                    cap_hubs=12, cap_links=80, render_below=6):
    """GENERIC 'think while searching' step: directory/association pages the qualifier rejected as
    non-companies are often MEMBER LISTS of the exact target companies. For each STRONGLY on-niche
    hub (entity=directory/association AND the LLM judged nicheFit=core), crawl it and harvest the
    outbound member company domains as fresh candidates. No site is hardcoded.

    GUARDS (learned from a noisy run):
      - only mine nicheFit == 'core' hubs (peripheral hubs like social-services portals leaked
        charities/off-target orgs);
      - the harvested Lead carries NO source_url so email scraping reads ONLY the member's own site
        (passing the hub as source_url made several members inherit the hub's email).

    JS-rendered member lists expose few links in raw HTML: when a `renderer` (headless Chromium) is
    given and static harvest is thin (< render_below), the hub is re-fetched fully-rendered and
    re-harvested — generic, no per-site logic."""
    hubs = [p for p in buckets.get("source_ref", [])
            if p.get("entity") in ("directory", "association") and p.get("nicheFit") == "core"]
    found = []
    for h in hubs[:cap_hubs]:
        url = h.get("website") or h.get("sourceUrl") or ""
        html = fetcher.get(url) if url else ""
        links = harvest_company_links(html, url, cap=cap_links) if html else []
        if len(links) < render_below and renderer is not None and url:
            rhtml = renderer.render(url)
            if rhtml:
                rlinks = harvest_company_links(rhtml, url, cap=cap_links)
                if len(rlinks) > len(links):
                    links = rlinks
        for dom, name in links:
            if not dom or dom in seen_domains:
                continue
            seen_domains.add(dom)
            # NB: source_url left empty on purpose (guard) so scrape reads only the member's own site.
            found.append(Lead(name=name, website="https://" + dom, country=country, source="hub"))
    return found


def refine_prospects(prospects, *, settings, fetcher, renderer=None, niche, country,
                     market_tld="", buzz=None):
    """Run the full quality stage and return a ranked list of QUALIFIED prospects plus metrics.

    Returns {"qualified": [...best-first...], "excluded": int, "hubsMined": int, "hubCompanies": int}.
    `prospects` are the raw discovered prospect dicts (post email-enrichment)."""
    icp = build_icp(niche, country, buzz=buzz)
    classifier = make_classifier(settings, niche, country)
    workers = max(1, getattr(settings, "scrape_workers", 10))
    min_keep = int(getattr(settings, "min_keep_score", 40))

    buckets = qualify(prospects, fetcher, icp, country=country, niche=niche, market_tld=market_tld,
                      workers=workers, classifier=classifier, min_keep_score=min_keep)

    # Hub expansion: mine member companies out of on-niche directory/association pages.
    seen = {registrable_domain(p.get("website", "")) for k in buckets for p in buckets[k]}
    seen.discard("")
    hubs_before = len([p for p in buckets.get("source_ref", [])
                       if p.get("entity") in ("directory", "association") and p.get("nicheFit") == "core"])
    hub_leads = expand_via_hubs(buckets, fetcher, seen, country=country, renderer=renderer)
    n_hub_companies = 0
    if hub_leads:
        scrape_emails(hub_leads, fetcher, workers, getattr(settings, "max_scrape", 200))
        hub_prospects = leads_to_prospects(hub_leads)
        n_hub_companies = len(hub_prospects)
        hub_buckets = qualify(hub_prospects, fetcher, icp, country=country, niche=niche,
                              market_tld=market_tld, workers=workers, classifier=classifier,
                              min_keep_score=min_keep)
        for k in buckets:
            buckets[k].extend(hub_buckets.get(k, []))

    qualified = [p for key in ("contacts", "generic", "qualified_no_email") for p in buckets.get(key, [])]
    qualified.sort(key=lambda p: (p.get("score", 0), 1 if p.get("email") else 0), reverse=True)
    for i, p in enumerate(qualified):
        p["ranking"] = i + 1
    excluded = len(buckets.get("rejected", [])) + len(buckets.get("source_ref", []))
    return {"qualified": qualified, "excluded": excluded,
            "hubsMined": hubs_before, "hubCompanies": n_hub_companies}
