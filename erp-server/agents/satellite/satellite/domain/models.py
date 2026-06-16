"""Domain models + pure logic for LEAD SATELLITE, ported from n8n workflow dCGzrlpaxpxJanbJ
(EVERTRUST - LEAD SATELLITE copy 6 (PG)).

Satellite hunts prospects for a campaign's niche x cities and writes them to the ERP. This
module holds the pure, unit-testable pieces (no I/O): config shape, segment fan-out with the
workflow's caps, lead parsing/dedup/email-status, Cloudflare email decode, and the
lead -> prospect mapping. Search/LLM/HTTP live in clients/.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# --- config ----------------------------------------------------------------

@dataclass(frozen=True)
class CampaignConfig:
    campaign_id: str
    niche: str = ""
    niche_id: str | None = None
    niche_slug: str = ""
    targets: list = field(default_factory=list)  # [{id,name,slug,searchHint}]
    region: str = ""
    country: str = ""
    project: str = ""
    default_regions: list = field(default_factory=list)
    max_leads_per_run: int = 500


@dataclass(frozen=True)
class Segment:
    niche: str
    city: str
    country: str
    focus: str
    niche_target_id: str | None
    niche_target_name: str
    niche_target_phrase: str
    system_content: str
    user_content: str


@dataclass
class Lead:
    name: str
    type: str = ""
    email: str = ""
    website: str = ""
    city: str = ""
    country: str = ""
    source_url: str = ""
    niche_target_id: str | None = None
    status: str = ""  # '' (ok) | PROTECTED | NO_EMAIL


# --- city normalization (port of the FOLD map) -----------------------------

_FOLD = {
    "ł": "l", "ą": "a", "ć": "c", "ę": "e", "ń": "n", "ó": "o", "ś": "s",
    "ź": "z", "ż": "z", "ä": "a", "ö": "o", "ü": "u", "ß": "ss",
}


def norm_city(s: str) -> str:
    t = str(s or "").lower().strip()
    t = "".join(_FOLD.get(ch, ch) for ch in t)
    return re.sub(r"[^a-z0-9]", "", t)


# --- email status / validation (port of emailStatus + isBad) ---------------

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
_BAD_FRAGMENTS = ("example.", "sentry", "wixpress", "no-reply", "noreply", ".png", ".jpg",
                  "@2x", "domain.com", "protected", "cloudflare", "[email")


def is_bad_email(email: str) -> bool:
    s = str(email or "").strip().lower()
    if not s or "@" not in s:
        return True
    return any(b in s for b in _BAD_FRAGMENTS)


def email_status(raw: str) -> tuple[str, str]:
    """Returns (email, status): ('', 'PROTECTED'|'NO_EMAIL') or (email, '')."""
    e = str(raw or "").strip()
    s = e.lower()
    if s and "@" in s and "protected" not in s and "[email" not in s and "cloudflare" not in s and "example." not in s:
        return e, ""
    if "protected" in s or "[email" in s or "cloudflare" in s:
        return "", "PROTECTED"
    return "", "NO_EMAIL"


# --- Cloudflare email decode + HTML extraction (port of Decode node) --------

def decode_cf_email(hex_str: str) -> str:
    try:
        if not hex_str or len(hex_str) < 6 or len(hex_str) % 2:
            return ""
        key = int(hex_str[0:2], 16)
        out = []
        for i in range(2, len(hex_str), 2):
            c = int(hex_str[i:i + 2], 16) ^ key
            if c < 9 or c > 126:
                return ""
            out.append(chr(c))
        return "".join(out)
    except (ValueError, TypeError):
        return ""


def _clean_email(e: str) -> str:
    e = re.sub(r"^mailto:", "", str(e or "").strip(), flags=re.IGNORECASE).split("?")[0].strip()
    if not _EMAIL_RE.match(e):
        return ""
    return "" if is_bad_email(e) else e


def extract_emails_from_html(html: str, domain: str = "") -> str:
    """Pull the best email from a page: Cloudflare-decoded, then mailto, then plain text;
    prefer on-domain, then role addresses."""
    if not html:
        return ""
    found: list[str] = []
    for m in re.findall(r'(?:data-cfemail="|/cdn-cgi/l/email-protection#)([0-9a-fA-F]{6,})', html):
        e = _clean_email(decode_cf_email(m))
        if e:
            found.append(e)
    for m in re.findall(r"mailto:[^\"'>\s?]+", html, flags=re.IGNORECASE):
        e = _clean_email(m)
        if e:
            found.append(e)
    for m in re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", html):
        e = _clean_email(m)
        if e:
            found.append(e)
    if not found:
        return ""
    uniq = list(dict.fromkeys(found))
    key = (domain or "").split(".")[0]
    on_dom = next((e for e in uniq if key and key in (e.split("@")[1] if "@" in e else "")), None)
    role = next((e for e in uniq if re.match(
        r"^(office|info|kontakt|contact|sales|hello|admin|mail|biuro|vertrieb|sekretariat)@", e, re.I)), None)
    return on_dom or role or uniq[0]


# --- segment fan-out (port of Build Search Query, caps preserved) ----------

_FOCI = ["dir_consumer", "dir_b2b", "maps_assoc", "broad"]
_MAX_PAIRS = 500


def _cities_from(cfg: CampaignConfig) -> list[str]:
    raw = cfg.region or ""
    entries = [c.strip() for c in re.split(r"[,;\n]+", raw) if c.strip()]
    if not entries:
        entries = [str(c).strip() for c in (cfg.default_regions or []) if str(c).strip()]
    seen, out = set(), []
    for c in entries:
        k = norm_city(c)
        if k and k not in seen:
            seen.add(k)
            out.append(c)
    return out


def build_segments(cfg: CampaignConfig) -> list[Segment]:
    cities = _cities_from(cfg)
    targets = [t for t in (cfg.targets or []) if t and (t.get("id") is not None or t.get("name") or t.get("slug"))]
    if not targets:
        targets = [{"id": cfg.niche_id, "name": cfg.niche, "slug": cfg.niche_slug, "searchHint": ""}]
    if not cfg.niche or not cities:
        return []

    country = cfg.country or "Germany"
    max_segments = cfg.max_leads_per_run if cfg.max_leads_per_run and cfg.max_leads_per_run > 0 else 500
    cities_per_target = max(1, _MAX_PAIRS // max(1, len(targets)))
    cities = cities[:cities_per_target]
    seg_per_city = 4 if len(cities) <= 2 else 3 if len(cities) <= 4 else 2 if len(cities) <= 8 else 1

    out: list[Segment] = []
    for tg in targets:
        phrase = str(tg.get("searchHint") or tg.get("name") or tg.get("slug") or cfg.niche).strip()
        niche = phrase.upper()
        for city in cities:
            for focus in _FOCI[:max(1, min(seg_per_city, len(_FOCI)))]:
                system = (
                    f"You are a B2B lead researcher for Evertrust GmbH. Use web_search to find real "
                    f"{niche} companies in ONE city. Output a SINGLE JSON object only: "
                    f'{{ "leads": [ {{ "name": "", "type": "", "email": "", "website": "", '
                    f'"city": "{city}", "country": "{country}", "source": "web-search", "sourceURL": "" }} ] }}'
                )
                user = (
                    f"Campaign niche: {niche}\nTarget city (ONLY this one): {city}\nCountry: {country}\n"
                    f"Segment focus: {focus}\nReturn ONLY the JSON object from the system prompt."
                )
                out.append(Segment(
                    niche=niche, city=city, country=country, focus=focus,
                    niche_target_id=tg.get("id"), niche_target_name=str(tg.get("name") or ""),
                    niche_target_phrase=phrase, system_content=system, user_content=user,
                ))
    return out[:max_segments]


# --- dedup + prospect mapping ----------------------------------------------

def dedup_leads(leads: list[Lead]) -> list[Lead]:
    seen, out = set(), []
    for ld in leads:
        name = (ld.name or "").strip()
        if not name:
            continue
        dom = re.sub(r"^https?://", "", (ld.website or "").strip().lower())
        dom = re.sub(r"^www\.", "", dom).split("/")[0]
        key = dom or re.sub(r"[^a-z0-9]", "", name.lower())
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(ld)
    return out


def leads_to_prospects(leads: list[Lead]) -> list[dict]:
    prospects = []
    for ld in leads:
        name = (ld.name or "").strip()
        if not name:
            continue
        email = (ld.email or "").strip()
        verified = bool(email and not is_bad_email(email) and ld.status == "")
        prospects.append({
            "email": email if verified else "",
            "companyName": name,
            "website": (ld.website or "").strip(),
            "city": (ld.city or "").strip(),
            "country": (ld.country or "").strip(),
            "sourceUrl": (ld.source_url or "").strip(),
            "nicheTargetId": ld.niche_target_id,
            "emailVerified": verified,
        })
    return prospects
