"""Tender-hunter discovery logic for LEAD SATELLITE (pure, testable — no I/O).

The goal: from a campaign niche, find as many companies as possible that are plausible
participants in / suppliers for PUBLIC TENDERS in that niche (German public sector first).
We expand the niche into many buzzwords, cross them with tender/procurement modifiers and
geography to build a large query set, then classify + score each scraped company so the
best tender prospects rank first.

Buzzword generation is LLM-enhanced (clients/llm.generate_buzzwords) with the deterministic
fallback here so the pipeline still exhausts the search space when the LLM is off.
"""
from __future__ import annotations

import re

# Generic, multilingual term sets (NOT per-country tables). The campaign's LOCAL-language niche +
# contact words come from the LLM profiler/buzzwords, so there is NO hardcoded country list here.
# CONTACT_TERMS = a generic "find the company's own site" set; TENDER_TERMS = weak tender-intent
# words used only as a scoring signal + one optional query pass (never crossed onto every buzzword).
CONTACT_TERMS = ("kontakt", "contact", "impressum")
TENDER_TERMS = ("tender", "procurement", "supplier", "vendor", "ausschreibung", "vergabe",
                "auftraggeber", "lieferant", "przetarg", "zamówienia", "közbeszerzés")

# Company-type classification keyword map (longest/most-specific first wins).
_TYPE_RULES = [
    ("Manufacturer", ("manufactur", "hersteller", "produzent", "produkt", "factory", "werk", "fabrik")),
    ("Rental", ("rental", "vermietung", "verleih", " hire", "rent ", "wypożyczalnia")),
    ("Distributor", ("distributor", "großhandel", "grosshandel", "wholesale", "hurtownia")),
    ("Integrator", ("integrator", "systemhaus", "solutions", "system integration", "engineering")),
    ("Service", ("service", "dienstleist", "agentur", "agency", "consult", "beratung", "usługi")),
    ("Supplier", ("supplier", "lieferant", "zulieferer", "dostawca")),
    ("Reseller", ("shop", "store", "handel", "reseller", "sklep")),
]

# Generic ccTLD geo logic (NO hardcoded country list). The campaign country's own ccTLD comes from
# the profiler's iso2 (passed as market_tld). Two-letter labels commonly used as generic gTLDs
# (startups on .io/.ai/.co etc.) are NOT treated as a foreign country.
_GTLD_LIKE = {"io", "ai", "co", "me", "tv", "fm", "ly", "gg", "sh", "to", "cc", "app", "dev"}


def _cctld(host: str) -> str:
    """The host's last DNS label if it's a 2-letter country code, else '' (gTLD like com/org/net)."""
    host = (host or "").lower().split(":")[0].rstrip(".")
    last = host.rsplit(".", 1)[-1] if "." in host else ""
    return last if (len(last) == 2 and last.isalpha()) else ""


def fallback_buzzwords(niche: str) -> list[str]:
    """Deterministic niche expansion used when the LLM is off or returns nothing.
    Not as rich as the LLM set, but enough to widen discovery well beyond the bare niche."""
    n = (niche or "").strip()
    if not n:
        return []
    base = [n]
    words = [w for w in re.split(r"\s+", n) if len(w) > 2]
    # Drop one qualifier at a time so e.g. "LED Container Rental" also yields "LED Container",
    # "Container Rental", "LED", "Container".
    if len(words) >= 2:
        base.append(" ".join(words[:-1]))
        base.append(" ".join(words[1:]))
        base.extend(words)
    generic = [f"{n} company", f"{n} manufacturer", f"{n} supplier",
               f"{n} provider", f"{n} solutions", f"{n} services"]
    out, seen = [], set()
    for b in base + generic:
        k = b.lower().strip()
        if k and k not in seen:
            seen.add(k)
            out.append(b.strip())
    return out


def build_tender_queries(buzzwords: list[str], cities: list[str], country: str,
                         cap: int = 240) -> list[tuple[str, str]]:
    """Build the discovery query set as (query, city) pairs. The city is carried so discovery can
    attribute each scraped lead to the right city. The SearXNG `language` hint already biases
    results to the local market, so we keep queries CLEAN (native buzzwords + geo) instead of
    cross-multiplying English/German tender words onto everything (which pulls in job boards).
    Tender intent is a small, local-language query pass plus a scoring signal — not a hard filter."""
    geos: list[str] = []
    for c in (cities or []):
        cc = (c or "").strip()
        if cc and cc.lower() not in ("anywhere", "any", ""):
            geos.append(cc)
    geo_words = geos if geos else [country or ""]
    contact = "kontakt"                 # generic; the local contact word is also in the buzzword set
    tenders = list(TENDER_TERMS[:3])    # generic tender-signal pass (no per-country table)

    out: list[tuple[str, str]] = []
    seen: set = set()

    def add(q: str, city: str) -> bool:
        q = " ".join((q or "").split()).strip()
        k = q.lower()
        if q and k not in seen:
            seen.add(k)
            out.append((q, city))
        return len(out) < cap

    # 1) The bulk: each native buzzword, clean + geo-qualified + a contact variant.
    for bw in buzzwords:
        bw = (bw or "").strip()
        if not bw:
            continue
        for geo in geo_words:
            if not add(f"{bw} {geo}", geo):
                return out
            if not add(f"{bw} {contact} {geo}", geo):
                return out
    # 2) A focused tender-signal pass: top buzzwords x local-language tender terms (no single city).
    for bw in buzzwords[:15]:
        for tt in tenders:
            if not add(f"{bw} {tt}", ""):
                return out
    return out


def classify_company_type(name: str, snippet: str, url: str, niche_target: str = "") -> str:
    """Heuristic company-type label from the result text. Generic 'Company' when unknown
    (a long niche phrase is not a useful 'type')."""
    hay = " ".join((name or "", snippet or "", url or "")).lower()
    for label, keys in _TYPE_RULES:
        if any(k in hay for k in keys):
            return label
    return "Company"


def geo_relevant(url: str, name: str, snippet: str, country: str, cities: list[str],
                 market_tld: str = "") -> bool:
    """Keep results on the campaign country's own ccTLD or on a neutral gTLD (.com/.org/.io); drop a
    DIFFERENT country's ccTLD (a foreign market). Fully dynamic — `market_tld` is the campaign
    country's ccTLD from the profiler's iso2; no hardcoded country list."""
    host = (url or "").lower().split("//")[-1].split("/")[0].split(":")[0]
    if not market_tld:
        return True                     # unknown campaign ccTLD -> can't judge foreignness, keep
    if host.endswith(market_tld):
        return True
    cc, market_cc = _cctld(host), market_tld.lstrip(".")
    return not (cc and cc != market_cc and cc not in _GTLD_LIKE)


def _niche_terms(niche: str) -> list[str]:
    return [w.lower() for w in re.split(r"\s+", niche or "") if len(w) > 2]


def score_lead(*, name: str, snippet: str, url: str, country: str, niche: str,
               has_email: bool, verified: bool, cities: list[str] | None = None,
               market_tld: str = "") -> int:
    """Relevance score 0..100 — drives ranking. Rewards on-niche text, tender intent, a
    reachable contact, and an on-market (EU/DACH) domain; penalizes global off-market noise."""
    hay = " ".join((name or "", snippet or "")).lower()
    host = (url or "").lower().split("//")[-1].split("/")[0]
    score = 20
    if verified:
        score += 22
    elif has_email:
        score += 8
    terms = _niche_terms(niche)
    if terms and any(t in hay for t in terms):
        score += 15
    if any(t in hay for t in ("tender", "procurement", "ausschreibung", "vergabe",
                              "auftraggeber", "lieferant", "supplier", "öffentlich")):
        score += 12
    # Geography (fully dynamic, no country table): the campaign country's own ccTLD (market_tld from
    # the profiler's iso2) is best; a DIFFERENT country's ccTLD is penalized; neutral gTLDs
    # (.com/.org/.io) score 0 there and a country-name mention is a mild signal.
    market_cc = (market_tld or "").lstrip(".")
    cc = _cctld(host)
    if market_tld and host.endswith(market_tld):
        score += 22
    elif market_tld and cc and cc != market_cc and cc not in _GTLD_LIKE:
        score -= 25
    if country and country.lower() in hay:
        score += 6
    return max(0, min(100, score))


def rank_label(score: int, min_b: int = 40) -> str:
    """Tier label from the relevance score — AAA / A / B / C. AAA = strong (contactable + on-niche +
    on-market), A = solid, B = weak but usable (keep-for-manual), C = below the keep floor `min_b`
    (noise — the pipeline DROPS tier C, keeping only B and above)."""
    if score >= 75:
        return "AAA"
    if score >= 50:
        return "A"
    if score >= min_b:
        return "B"
    return "C"
