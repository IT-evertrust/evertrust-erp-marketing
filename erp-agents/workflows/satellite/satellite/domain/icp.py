"""ICP (Ideal Customer Profile) — generalized qualify + tier layer for LEAD SATELLITE.

Replaces the old "has a niche keyword + has an email -> score ~64 -> tier A" default bucket with a
GATED funnel. A candidate must pass, in order:

    ENTITY  -> is it a real company? (drop event / association / gov / edu / news / jobboard /
               directory / training -> route to a 'source/reference' bucket, never a lead)
    NICHE   -> is the niche its CORE business? (core vs peripheral vs incidental, from page EVIDENCE,
               not from a single keyword hit)
    REVENUE -> verified revenue gate (AAA/AA/A thresholds). Unknown -> capped at B (never invented).
    CONTACT -> a usable business/decision-maker contact (drives ranking, not the tier itself)

Only AFTER the gates is a row tiered AAA/AA/A/B, or EXCLUDE'd. This is niche-AGNOSTIC: an `ICP`
instance describes ONE target profile (terms, revenue thresholds, decision titles); the
cybersecurity profile below is the first config. Pure, no I/O — fed normalized text
(name + snippet + crawled page text) of each candidate.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import urlsplit

# ---- entity types ------------------------------------------------------------
COMPANY = "company"
EVENT, ASSOCIATION, GOV, EDU, NEWS, JOBBOARD, DIRECTORY, TRAINING = (
    "event", "association", "gov", "edu", "news", "jobboard", "directory", "training")
NON_COMPANY = (EVENT, ASSOCIATION, GOV, EDU, NEWS, JOBBOARD, DIRECTORY, TRAINING)

# ---- email confidence (best -> worst), per the spec's email_status ladder -----
VERIFIED, PUBLIC_FOUND, ACCEPT_ALL, GUESSED, GENERIC, NO_EMAIL = (
    "verified", "public_found", "accept_all", "guessed", "generic", "no_email")
EMAIL_RANK = {VERIFIED: 5, PUBLIC_FOUND: 4, ACCEPT_ALL: 3, GUESSED: 2, GENERIC: 1, NO_EMAIL: 0}

# ---- tiers -------------------------------------------------------------------
AAA, AA, A, B, EXCLUDE = "AAA", "AA", "A", "B", "EXCLUDE"

_GENERIC_LOCALS = ("info", "kontakt", "contact", "office", "mail", "hello", "anfrage", "service",
                   "sales", "vertrieb", "buero", "büro", "biuro", "bureau", "post", "empfang",
                   "sekretariat", "biz", "firma", "company")


# ---- entity signals ----------------------------------------------------------
# STRONG, domain/host-anchored signals: a TLD or host that DEFINITIVELY marks a non-company. These
# win outright (a .bund.de host is gov no matter what the page says).
_DOMAIN_SIGNALS = {
    GOV: (".bund.de", ".gov", "gov.", "polizei", ".justiz", "justiz-", "staatsanwalt",
          "ministerium", "landesamt", "bundesamt", "behoerde", "behörde"),
    EDU: (".edu", "edu.", "hochschule", "universit", "uni-", "-uni.", "dhbw", "th-", "fh-", "hs-",
          "fachhochschule", "berufsschule"),
    JOBBOARD: ("stepstone", "indeed.", "glassdoor", "monster.", "stellenanzeige", "stellenangebot",
               "kimeta", "jobs.", "/jobs", "karriere."),
    DIRECTORY: ("wlw.de", "wer-liefert-was", "dasoertliche", "gelbeseiten", "11880", "cylex",
                "kompass.com", "europages", "f6s.com", "clutch.co", "yelp.", "firmenwissen",
                "northdata", "branchenbuch", "meinestadt", "marktplatz"),
    NEWS: ("presseportal", "newsaktuell", "zeitung", "tageblatt", "wochenblatt", "magazin",
           "redaktion", "/news/", "news.", "/blog/", "blog.", "-news."),
}
# WEAKER, text/name signals: a non-company unless the name carries a real legal form (a GmbH page
# that merely *mentions* an event/initiative is still a company). GOV/EDU text wins regardless.
_TEXT_SIGNALS = {
    EVENT: ("summit", "kongress", "konferenz", "konferenc", "tagung", "meetup", "expo ", " messe",
            "veranstaltung", "tag der ", "webinar", "jetzt anmelden", "save the date", "ticket"),
    ASSOCIATION: (" e.v.", "e. v.", "verein", "verband", "allianz für", "allianz fuer", "initiative",
                  "buendnis", "bündnis", "cyberwehr", "kompetenzzentrum", "cluster", "stiftung",
                  "foundation", "gemeinnützig", "gemeinnuetzig", "netzwerk e", "förderverein"),
    TRAINING: ("college", "akademie", "seminar", "schulung", "weiterbildung", "lehrgang", "bootcamp",
               "e-learning", "elearning", "zertifizierungskurs", "ausbildung", "kursangebot"),
    GOV: ("generalstaatsanwalt", "amtsgericht", "stadtverwaltung", "landkreis", "kreisverwaltung",
          "polizeipräsidium", "polizeipraesidium"),
}
_LEGAL_FORM = ("gmbh", " ag", " ag ", "ag&", " ug", "mbh", "e.k.", " kg", " ltd", "sp. z o.o",
               "s.a.", " se ", " bv", " oHG".lower())

# Unambiguous full-word GOV/EDU markers checked against the NAME too (a host isn't always present).
# Kept to whole words (no short '-' prefixes) so a company name like 'Uni-Soft GmbH' is not edu.
_NAME_GOV_EDU = {
    GOV: ("ministerium", "behörde", "behoerde", "bundesamt", "landesamt", "generalstaatsanwalt",
          "amtsgericht", "polizeipräsidium", "polizeipraesidium", "stadtverwaltung"),
    EDU: ("hochschule", "universität", "universitaet", "fachhochschule", "berufsschule", "dhbw"),
}


def _host(url: str) -> str:
    try:
        h = urlsplit(url if "//" in (url or "") else "//" + (url or "")).netloc.lower()
    except Exception:
        h = ""
    return h[4:] if h.startswith("www.") else h


def classify_entity(name: str = "", snippet: str = "", url: str = "", text: str = "") -> str:
    """COMPANY, or one of NON_COMPANY. Domain signals are definitive; text signals classify a
    non-company unless the NAME carries a real legal form (then weak event/association mentions are
    ignored as 'a company that talks about an event')."""
    hay_dom = (_host(url) + " " + (url or "")).lower()
    name_l = (name or "").lower()
    for etype, sigs in _DOMAIN_SIGNALS.items():
        if any(s in hay_dom for s in sigs):
            return etype
    for etype, sigs in _NAME_GOV_EDU.items():     # gov/edu are unambiguous in the NAME too
        if any(s in name_l for s in sigs):
            return etype
    hay = " ".join((name or "", snippet or "", text or "")).lower()
    has_legal = any(lf in name_l for lf in _LEGAL_FORM)
    for etype, sigs in _TEXT_SIGNALS.items():
        if any(s in hay for s in sigs):
            if etype in (GOV, EDU):            # public-sector terms always win
                return etype
            if has_legal and etype in (EVENT, ASSOCIATION, TRAINING):
                continue                       # a real company merely mentioning one
            return etype
    return COMPANY


# ---- UNIVERSAL structural signals (language-AGNOSTIC) -------------------------
# TLDs and global platform brands are structure, not language — safe to hardcode for every country.
# Everything language-specific (association / event / training / news words) is left to the LLM.
_GOV_TLD = (".gov", "gov.")
_EDU_TLD = (".edu", "edu.", ".ac.")
_GLOBAL_PLATFORMS = {
    "linkedin.": DIRECTORY, "facebook.": DIRECTORY, "instagram.": DIRECTORY, "youtube.": DIRECTORY,
    "twitter.": DIRECTORY, "x.com": DIRECTORY, "xing.": DIRECTORY, "wikipedia.": NEWS,
    "crunchbase.": DIRECTORY, "yelp.": DIRECTORY, "tripadvisor.": DIRECTORY, "trustpilot.": DIRECTORY,
    "indeed.": JOBBOARD, "stepstone.": JOBBOARD, "glassdoor.": JOBBOARD, "monster.": JOBBOARD,
}

# Map an LLM's entityType word (any phrasing) to our buckets; anything unrecognized -> a company
# (be lenient — don't drop a real business because the model used an odd label).
_NON_COMPANY_ALIASES = {
    "government": GOV, "gov": GOV, "public authority": GOV, "authority": GOV, "ministry": GOV,
    "education": EDU, "educational": EDU, "university": EDU, "school": EDU, "academia": EDU,
    "event": EVENT, "conference": EVENT, "meetup": EVENT,
    "association": ASSOCIATION, "ngo": ASSOCIATION, "initiative": ASSOCIATION, "foundation": ASSOCIATION,
    "news": NEWS, "media": NEWS, "blog": NEWS, "magazine": NEWS, "press": NEWS,
    "jobboard": JOBBOARD, "job board": JOBBOARD, "recruitment": JOBBOARD,
    "directory": DIRECTORY, "marketplace": DIRECTORY, "aggregator": DIRECTORY,
    "training": TRAINING, "course": TRAINING, "academy": TRAINING,
}


def structural_entity(url: str) -> str | None:
    """Universal entity signal from the host alone: gov/edu/academic TLDs + well-known global
    platforms. Returns a NON_COMPANY type, or None to let the LLM judge (language-agnostically)."""
    h = _host(url)
    if not h:
        return None
    if any(s in h for s in _GOV_TLD):
        return GOV
    if any(s in h for s in _EDU_TLD):
        return EDU
    for brand, etype in _GLOBAL_PLATFORMS.items():
        if brand in h:
            return etype
    return None


def normalize_entity(s: str) -> str:
    return _NON_COMPANY_ALIASES.get((s or "").strip().lower(), COMPANY)


def normalize_fit(s: str) -> str | None:
    f = (s or "").strip().lower()
    if f in ("core", "primary", "main"):
        return "core"
    if f in ("peripheral", "related", "secondary", "adjacent"):
        return "peripheral"
    if f in ("none", "unrelated", "no"):
        return "none"
    return None


@dataclass(frozen=True)
class ICP:
    """One target profile. Niche-agnostic: swap the term lists + thresholds for another niche."""
    name: str
    core_terms: tuple = ()          # markers that the niche is the CORE business
    peripheral_terms: tuple = ()    # adjacent business where the niche is a sub-area
    incidental_terms: tuple = ()    # generic stems that alone do NOT qualify (e.g. 'sicherheit')
    core_min_hits: int = 2          # how many distinct core markers = 'core' (avoids 1-keyword luck)
    revenue_aaa: float = 20_000_000
    revenue_aa: float = 12_000_000
    revenue_min: float = 12_000_000  # verified revenue below this = EXCLUDE
    decision_titles: tuple = ()


def niche_signals(text: str, icp: ICP) -> tuple[int, int]:
    """(core_hits, peripheral_hits) — count of DISTINCT niche markers present in the evidence text.
    The markers are the AIM niche's own (profiler-generated, bilingual) keywords — so this matches
    exactly what AIM asked for, in the target country's language, with no hardcoded niche table."""
    low = (text or "").lower()
    core = sum(1 for t in icp.core_terms if t and t in low)
    peri = sum(1 for t in icp.peripheral_terms if t and t in low)
    return core, peri


def niche_fit(text: str, icp: ICP) -> str:
    """'core' | 'peripheral' | 'incidental' | 'none' — from EVIDENCE text. 'core' needs >=
    icp.core_min_hits markers so a firm that merely name-drops one niche word is not mistaken
    for a provider in that niche."""
    core, peri = niche_signals(text, icp)
    if core >= icp.core_min_hits:
        return "core"
    if core >= 1 or peri >= 1:
        return "peripheral"
    if any(t in (text or "").lower() for t in icp.incidental_terms):
        return "incidental"
    return "none"


def build_icp(niche: str, country: str = "", profile: dict | None = None, buzz=None, *,
              core_min_hits: int = 2, peripheral_terms=(), incidental_terms=()) -> ICP:
    """Build an ICP DYNAMICALLY from the AIM input — niche-agnostic, no hardcoded niche table.
    The core markers are the niche's own bilingual keywords (profiler keywordsLocal + keywordsEnglish,
    and/or the buzzword set) plus the niche name itself. So whatever AIM types as the niche, the
    qualify gate looks for exactly that, in the target country's language."""
    kws: list[str] = []
    if profile:
        kws += list(profile.get("keywordsLocal") or [])
        kws += list(profile.get("keywordsEnglish") or [])
    if buzz:
        kws += list(buzz)
    terms, seen = [], set()
    for k in kws + [niche]:
        k = (k or "").strip().lower()
        # keep distinctive markers; drop ultra-short tokens that would match generically.
        if len(k) >= 3 and k not in seen:
            seen.add(k)
            terms.append(k)
    return ICP(name=f"{niche} ({country})".strip(), core_terms=tuple(terms),
               peripheral_terms=tuple(t.lower() for t in peripheral_terms),
               incidental_terms=tuple(t.lower() for t in incidental_terms),
               core_min_hits=core_min_hits)


def email_status(email: str, *, source: str = "", mx_ok: bool | None = None,
                 catch_all: bool | None = None) -> str:
    """Map an address + how it was obtained to a confidence status. `source`: 'guessed' (pattern),
    'website'/'impressum' (scraped from the company's own page), or '' (unknown). `mx_ok`/`catch_all`
    come from a later verify step (None = not verified yet)."""
    if not email or "@" not in email:
        return NO_EMAIL
    if catch_all:
        return ACCEPT_ALL
    if source == "guessed":
        return GUESSED
    local = email.split("@", 1)[0].lower()
    is_generic = local in _GENERIC_LOCALS
    if mx_ok:
        return VERIFIED if not is_generic else GENERIC  # a verified personal box beats a generic one
    if is_generic:
        return GENERIC
    if source in ("website", "impressum"):
        return PUBLIC_FOUND
    return PUBLIC_FOUND if mx_ok is None else NO_EMAIL


def assign_tier(*, entity: str, core_hits: int = 0, peri_hits: int = 0, in_geo: bool = True,
                evidence_ok: bool = True, revenue_eur: float | None = None,
                revenue_verified: bool = False, use_revenue: bool = False,
                icp: ICP) -> tuple[str, str]:
    """Return (tier, reason). Ordered gates: 1) real company  2) in target geo  3) niche evidence.

    Default (use_revenue=False — revenue gate parked): tier by how deeply the company matches the
    AIM niche (count of distinct niche markers on its pages):
        >= core_min_hits+2 -> AAA   |  >= core_min_hits -> AA   |  >=1 marker -> A
        0 markers -> EXCLUDE if we actually read its pages, else B (couldn't crawl -> keep for manual)
    use_revenue=True restores the spec's revenue thresholds (kept for when a source is wired)."""
    if entity != COMPANY:
        return EXCLUDE, f"not-a-company:{entity}"
    if not in_geo:
        return EXCLUDE, "out-of-geo"
    is_core = core_hits >= icp.core_min_hits
    is_related = core_hits >= 1 or peri_hits >= 1
    if not is_related:
        # company in geo but no niche evidence: off-niche if we read its pages, else undecided -> B
        return (EXCLUDE, "off-niche") if evidence_ok else (B, "no-evidence-yet")

    if use_revenue:                                   # parked revenue path (re-enable when wired)
        rv = revenue_verified and revenue_eur is not None
        if rv and revenue_eur < icp.revenue_min:
            return EXCLUDE, f"verified-revenue<{int(icp.revenue_min / 1e6)}M"
        if is_core:
            if rv and revenue_eur >= icp.revenue_aaa:
                return AAA, "core+rev>=20M"
            if rv and revenue_eur >= icp.revenue_aa:
                return AA, "core+rev12-20M"
            return B, "core,revenue-unverified"
        if rv and revenue_eur >= icp.revenue_min:
            return A, "peripheral+rev>=12M"
        return B, "peripheral,revenue-unverified"

    # revenue-free default: tier by niche-evidence DEPTH
    if core_hits >= icp.core_min_hits + 2:
        return AAA, f"core-strong({core_hits} markers)"
    if is_core:
        return AA, f"core({core_hits} markers)"
    return A, f"related({core_hits or peri_hits} marker)"


# ---- first config: DE / DACH cybersecurity ----------------------------------
CYBERSECURITY = ICP(
    name="Cybersecurity (DACH)",
    core_terms=(
        "mssp", "managed security", "security operations", "soc ", "siem", "pentest",
        "penetration test", "penetrationstest", "incident response", "red team", "blue team",
        "threat intelligence", "threat hunting", "vulnerability", "schwachstellen", "forensik",
        "ransomware", "security consulting", "sicherheitsberatung", "informationssicherheit",
        "it-sicherheit", "it-security", "cyber security", "cybersecurity", "cybersicherheit",
        "iso 27001", "isms", "security audit", "security operations center", "edr", "xdr",
    ),
    peripheral_terms=(
        "systemhaus", "managed it", "managed service", "it-service", "it-dienstleist",
        "it-infrastruktur", "netzwerktechnik", "cloud", "firewall", "backup", "endpoint",
        "it-betreuung", "it-support",
    ),
    incidental_terms=("sicherheit", "security", "datenschutz", "schutz"),
    core_min_hits=2,
    revenue_aaa=20_000_000, revenue_aa=12_000_000, revenue_min=12_000_000,
    decision_titles=(
        "ceo", "cto", "ciso", "coo", "geschäftsführer", "geschaeftsführer", "geschäftsführung",
        "managing director", "inhaber", "gründer", "gruender", "founder", "co-founder", "owner",
        "vorstand", "prezes", "właściciel", "wlasciciel", "head of it", "head of security",
        "it-leiter", "leiter it", "vertriebsleiter", "sales director", "business development",
    ),
)
