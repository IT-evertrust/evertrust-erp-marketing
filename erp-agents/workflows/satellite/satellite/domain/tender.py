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

# Tender / procurement intent modifiers (English + German — German public sector is the
# primary market). Appended to buzzwords to bias results toward tender-relevant companies.
TENDER_MODIFIERS = [
    "tender", "public tender", "procurement", "public procurement", "supplier", "vendor",
    "framework agreement", "bid", "contractor",
    "Ausschreibung", "öffentliche Ausschreibung", "Vergabe", "Lieferant", "Anbieter",
    "öffentlicher Auftraggeber", "Bieter", "Rahmenvertrag", "Zulieferer",
]

# Generic discovery modifiers that surface a company's own site + contact details.
CONTACT_MODIFIERS = ["company", "kontakt impressum", "contact email", "GmbH", "Sp. z o.o."]

# Local-language tender / procurement terms by campaign country (used in a small, focused set
# of tender-signal queries — NOT cross-multiplied onto every buzzword, which pulls in job boards).
LOCAL_TENDER = {
    "Poland": ["przetarg", "zamówienia publiczne", "dostawca"],
    "Germany": ["Ausschreibung", "öffentliche Vergabe", "Lieferant"],
    "Austria": ["Ausschreibung", "Lieferant"],
    "Hungary": ["közbeszerzés", "beszállító"],
}
# Local contact term to surface a company's own site (one per country).
LOCAL_CONTACT = {"Poland": "kontakt", "Germany": "kontakt impressum",
                 "Austria": "kontakt", "Hungary": "kapcsolat"}

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

# Country-code TLDs we treat as on-market (boost in scoring). The EU/DACH neighbours are
# acceptable for German-public-sector tender work regardless of the campaign country.
_MARKET_TLDS = {"Germany": ".de", "Poland": ".pl", "Hungary": ".hu", "Austria": ".at"}
_EU_TLDS = (".de", ".pl", ".at", ".eu", ".cz", ".sk", ".nl", ".be", ".fr", ".hu", ".ch")
# Off-market TLDs that flag global noise (Asia/US/etc.) for a EU tender campaign.
_OFFMARKET_TLDS = (".vn", ".cn", ".in", ".id", ".th", ".ph", ".my", ".pk", ".bd", ".ng",
                   ".com.vn", ".com.cn", ".co.id", ".fj", ".sb", ".au", ".hk", ".tw", ".kr",
                   ".jp", ".us", ".ca", ".br", ".mx", ".ru", ".ae", ".sa", ".za", ".nz", ".sg")
# Country names (EN/native) we accept as an in-market geo signal in result text.
_MARKET_NAMES = {
    "Germany": ("germany", "deutschland", "german"),
    "Poland": ("poland", "polska", "polish", "polsce"),
    "Austria": ("austria", "österreich", "osterreich"),
    "Hungary": ("hungary", "magyarország", "magyarorszag"),
}
# SearXNG language hint per campaign country (biases results to the local market).
LANG_BY_COUNTRY = {"Germany": "de", "Austria": "de", "Poland": "pl", "Hungary": "hu"}


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
                         cap: int = 240) -> list[str]:
    """Build the discovery query set. The SearXNG `language` hint already biases results to the
    local market, so we keep queries CLEAN (native buzzwords + geo) instead of cross-multiplying
    English/German tender words onto everything (which pulls in job boards). Tender intent is a
    small, local-language query pass plus a scoring signal — not a hard query filter."""
    geos: list[str] = []
    for c in (cities or []):
        cc = (c or "").strip()
        if cc and cc.lower() not in ("anywhere", "any", ""):
            geos.append(cc)
    geo_words = geos if geos else [country or ""]
    contact = LOCAL_CONTACT.get(country or "", "kontakt")
    tenders = LOCAL_TENDER.get(country or "", ["tender", "procurement", "supplier"])

    out, seen = [], set()

    def add(q: str) -> bool:
        q = " ".join((q or "").split()).strip()
        k = q.lower()
        if q and k not in seen:
            seen.add(k)
            out.append(q)
        return len(out) < cap

    # 1) The bulk: each native buzzword, clean + geo-qualified + a contact variant.
    for bw in buzzwords:
        bw = (bw or "").strip()
        if not bw:
            continue
        for geo in geo_words:
            if not add(f"{bw} {geo}"):
                return out
            if not add(f"{bw} {contact} {geo}"):
                return out
    # 2) A focused tender-signal pass: top buzzwords x local-language tender terms.
    for bw in buzzwords[:15]:
        for tt in tenders:
            if not add(f"{bw} {tt}"):
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


def geo_relevant(url: str, name: str, snippet: str, country: str, cities: list[str]) -> bool:
    """Drop only clearly OFF-market results — global Asian/US/etc. ccTLDs. EU ccTLDs and neutral
    domains (.com/.org) are kept: the SearXNG `language` hint already biases the result set to the
    local market, so a Polish company on a .com is legitimate. Scoring then ranks EU domains higher."""
    host = (url or "").lower().split("//")[-1].split("/")[0]
    return not any(host.endswith(t) for t in _OFFMARKET_TLDS)


def _niche_terms(niche: str) -> list[str]:
    return [w.lower() for w in re.split(r"\s+", niche or "") if len(w) > 2]


def score_lead(*, name: str, snippet: str, url: str, country: str, niche: str,
               has_email: bool, verified: bool, cities: list[str] | None = None) -> int:
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
    # Geography: campaign-country ccTLD best, EU/DACH good, off-market heavily penalized.
    market = _MARKET_TLDS.get(country or "", "")
    if market and host.endswith(market):
        score += 22
    elif any(host.endswith(t) for t in _EU_TLDS):
        score += 14
    elif any(host.endswith(t) for t in _OFFMARKET_TLDS):
        score -= 30
    if country and country.lower() in hay:
        score += 6
    return max(0, min(100, score))


def rank_label(score: int) -> str:
    """Coarse tier label from a score (A best ... D weakest) — handy for the sheet."""
    if score >= 75:
        return "A"
    if score >= 55:
        return "B"
    if score >= 40:
        return "C"
    return "D"
