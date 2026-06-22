"""QUALIFY stage for LEAD SATELLITE — turn raw discovered companies into TIERED, BUCKETED leads.

Runs AFTER discovery + email enrichment. For each company it crawls a little of the REAL website
(home + a couple of common content pages), then applies the ICP gates from domain/icp.py:

    entity-type  ->  niche evidence (the AIM niche's own keywords)  ->  geo  ->  tier

Output is split into labelled buckets (per the spec's "export separate outputs") so non-companies
and qualified-but-no-email rows never pollute the outreach-ready contact list. The ICP is built
dynamically from the AIM niche (icp.build_icp) — niche-agnostic, nothing hardcoded.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

from .domain import icp as I
from .domain.scrape import registrable_domain

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_GTLD_LIKE = {"com", "org", "net", "io", "eu", "co", "ai", "dev", "tech", "info", "biz"}

# A few content pages worth a peek for niche evidence (DE + EN). Home first; the rest are best-effort.
_PATHS = ("", "/leistungen", "/services", "/loesungen", "/solutions", "/ueber-uns", "/about",
          "/produkte", "/products", "/portfolio")

# Bucket keys (the separate exports).
CONTACTS = "contacts"               # qualified + a real (non-generic) contact email -> outreach
GENERIC = "generic"                 # qualified but only info@/contact@ -> fallback
QUALIFIED_NO_EMAIL = "qualified_no_email"   # qualified company, no email yet -> retry/manual
REJECTED = "rejected"               # a company, but EXCLUDE'd (off-niche / out-of-geo)
SOURCE_REF = "source_ref"           # not a company (event/assoc/gov/edu/news/jobboard/directory)
BUCKETS = (CONTACTS, GENERIC, QUALIFIED_NO_EMAIL, REJECTED, SOURCE_REF)


def _text(html: str) -> str:
    return _WS.sub(" ", _TAG.sub(" ", html or "")).strip()


def crawl_evidence(website: str, fetcher, *, max_pages: int = 3, max_attempts: int = 5) -> str:
    """Fetch home + a few common content pages; return concatenated visible text (lowercased).
    Bounded: stops after `max_pages` pages with content or `max_attempts` requests (most 404s)."""
    base = (website or "").rstrip("/")
    if not base:
        return ""
    if "//" not in base:
        base = "https://" + base
    out, got, tried = [], 0, 0
    for path in _PATHS:
        if got >= max_pages or tried >= max_attempts:
            break
        tried += 1
        html = fetcher.get(base + path)
        if html:
            out.append(_text(html))
            got += 1
    return " ".join(out)[:20000].lower()


def _in_geo(website: str, market_tld: str) -> bool:
    """Lenient geo check (discovery already geo-targets): in-market unless the domain is clearly a
    DIFFERENT country's ccTLD. No market_tld configured -> trust discovery (True)."""
    if not market_tld:
        return True
    host = registrable_domain(website) or ""
    if host.endswith(market_tld):
        return True
    cc = host.rsplit(".", 1)[-1] if "." in host else ""
    if len(cc) == 2 and cc not in _GTLD_LIKE and ("." + cc) != market_tld:
        return False                      # a foreign ccTLD (.pl/.fr/...) for a DE campaign
    return True                           # neutral gTLD (.com/.io/...) -> allow


def _tier_from_llm_fit(fit: str | None, evidence_ok: bool):
    """Tier from the LLM's language-agnostic niche-fit verdict (revenue parked). None -> caller
    falls back to the keyword path."""
    if fit == "core":
        return I.AAA, "llm:core"
    if fit == "peripheral":
        return I.A, "llm:peripheral"
    if fit == "none":
        return (I.EXCLUDE, "llm:off-niche") if evidence_ok else (I.B, "no-evidence-yet")
    return None


def qualify(prospects: list[dict], fetcher, icp: I.ICP, *, country: str = "", market_tld: str = "",
            workers: int = 10, classifier=None, use_revenue: bool = False) -> dict:
    """Crawl + classify + tier + bucket.

    Entity + niche-fit are decided LANGUAGE-AGNOSTICALLY: universal structural signals (gov/edu TLDs,
    global platforms) first, then `classifier(name, url, text) -> {entityType, nicheFit}` (an LLM that
    reads the page in any language). With no classifier (offline/tests) it falls back to the rule-based
    keyword path. Mutates each prospect with entity/tier/tierReason/nicheHits/emailStatus and returns
    {bucket_key: [prospects]} ranked best-first."""
    def _crawl(p):
        # keep it light: home + 1 content page, max 3 attempts (some target sites are slow ~6s/fetch)
        return crawl_evidence(p.get("website", "") or p.get("sourceUrl", ""), fetcher,
                              max_pages=2, max_attempts=3)

    texts = list(ThreadPoolExecutor(max_workers=max(1, workers)).map(_crawl, prospects)) \
        if prospects else []

    out = {k: [] for k in BUCKETS}
    for p, text in zip(prospects, texts):
        name = p.get("companyName", "")
        website = p.get("website", "")
        evidence_ok = bool(text)
        core, peri = I.niche_signals(f"{name} {text}", icp)   # cheap keyword signal (fallback/extra)
        in_geo = _in_geo(website, market_tld)

        # 1) universal structural signal (TLD/global platform) — definitive, no language needed
        entity = I.structural_entity(website)
        fit = None
        # 2) else let the LLM judge entity + niche-fit on the crawled page (any language)
        if entity is None and classifier is not None:
            res = classifier(name, website, text) or {}
            entity = I.normalize_entity(res.get("entityType"))
            fit = I.normalize_fit(res.get("nicheFit"))
        # 3) else fall back to the rule-based (language-limited) classifier
        if entity is None:
            entity = I.classify_entity(name, "", website, text)

        if entity != I.COMPANY:
            tier, reason = I.EXCLUDE, f"not-a-company:{entity}"
        elif not in_geo:
            tier, reason = I.EXCLUDE, "out-of-geo"
        else:
            decided = _tier_from_llm_fit(fit, evidence_ok)    # LLM verdict authoritative when present
            tier, reason = decided if decided else I.assign_tier(
                entity=I.COMPANY, core_hits=core, peri_hits=peri, in_geo=True,
                evidence_ok=evidence_ok, use_revenue=use_revenue, icp=icp)

        email = p.get("email", "")
        est = I.email_status(email, source="website" if email else "")
        p.update(entity=entity, tier=tier, tierReason=reason, nicheHits=core,
                 evidenceChars=len(text), emailStatus=est)

        if entity in I.NON_COMPANY:
            out[SOURCE_REF].append(p)
        elif tier == I.EXCLUDE:
            out[REJECTED].append(p)
        elif not email:
            out[QUALIFIED_NO_EMAIL].append(p)
        elif est == I.GENERIC:
            out[GENERIC].append(p)
        else:
            out[CONTACTS].append(p)

    _rank = {I.AAA: 4, I.AA: 3, I.A: 2, I.B: 1, I.EXCLUDE: 0}
    for k in out:
        out[k].sort(key=lambda p: (_rank.get(p.get("tier"), 0), p.get("nicheHits", 0)), reverse=True)
        for i, p in enumerate(out[k]):
            p["ranking"] = i + 1
    return out
