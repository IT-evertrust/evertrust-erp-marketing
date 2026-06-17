"""Real web-scraping engine for LEAD SATELLITE.

The original pipeline asked an LLM to *invent* a few leads from a single search snippet.
This module makes leads come from ACTUAL scraped data: keyless discovery (DuckDuckGo) turns
straight into company candidates, then each candidate's website is scraped for a real email.
httpx + stdlib only — no bs4/lxml, no API keys, no LLM.

Pure helpers (testable, no I/O) + a fetcher-driven concurrent scraper. Email extraction +
Cloudflare decode live in models.py and are reused here.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import unquote, urlparse

from .models import Lead, Segment, extract_emails_from_html

# Hosts that are never a company website — social, search engines, marketplaces, aggregators,
# directories. They're noise as a *lead* (we still discover real sites alongside them).
_JUNK_HOST_FRAGMENTS = (
    "facebook.", "instagram.", "linkedin.", "twitter.", "x.com", "youtube.", "youtu.be",
    "pinterest.", "tiktok.", "wikipedia.", "wikidata.", "wikimedia.", "google.", "bing.",
    "duckduckgo.", "yandex.", "yelp.", "yellowpages.", "yallapages.", "tripadvisor.",
    "amazon.", "ebay.", "alibaba.", "indeed.", "glassdoor.", "crunchbase.", "trustpilot.",
    "reddit.", "quora.", "medium.", "blogspot.", "wordpress.com", "wix.com", "t.me",
    "wa.me", "whatsapp.com", "apple.com", "play.google", "maps.", "search.", "translate.",
    "archive.org", "scribd.", "slideshare.", "github.", "gov.", "europa.eu",
    # spam/parking/scraper-aggregator hosts seen in the wild
    "qanator.", "namepros.", "sedo.", "dan.com", "afternic.", "hugedomains.",
    "thegioididong.", "lazada.", "shopee.", "made-in-china.", "globalsources.", "thomasnet.",
)

_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
# Strip a trailing " | Home", " - Kontakt", " – Startseite" etc. from a page <title>.
_TITLE_TAIL = re.compile(
    r"\s*[\|\-–—:•·»>]+\s*(home|homepage|start|startseite|hauptseite|kontakt|contact|"
    r"about|about us|über uns|ueber uns|impressum|imprint|willkommen|welcome|official|"
    r"strona główna|o nas|home page)\b.*$",
    re.I,
)


def _text(s: str) -> str:
    s = _TAGS.sub("", s or "")
    s = s.replace("&amp;", "&").replace("&#x27;", "'").replace("&quot;", '"')
    s = re.sub(r"&[a-zA-Z#0-9]+;", " ", s)
    return _WS.sub(" ", s).strip()


def registrable_domain(url: str) -> str:
    """Bare host of a URL, www. stripped ('https://www.Foo.de/x' -> 'foo.de')."""
    try:
        netloc = urlparse(url if "://" in url else "https://" + url).netloc.lower()
    except ValueError:
        return ""
    host = netloc.split("@")[-1].split(":")[0]
    return host[4:] if host.startswith("www.") else host


def is_company_host(host: str) -> bool:
    """True if the host looks like a real company site (not social/search/aggregator)."""
    if not host or "." not in host:
        return False
    return not any(j in host for j in _JUNK_HOST_FRAGMENTS)


def clean_company_name(title: str) -> str:
    """Best-effort company name from a result title: tags stripped, ' | Home' tails removed."""
    t = _text(title)
    t = _TITLE_TAIL.sub("", t).strip(" -–—|:·•»>")
    return t[:120].strip()


def hit_to_lead(hit: dict, seg: Segment) -> Lead | None:
    """A search result -> a Lead candidate (no email yet), or None if it's a junk domain."""
    url = (hit.get("url") or "").strip()
    host = registrable_domain(url)
    if not is_company_host(host):
        return None
    name = clean_company_name(hit.get("title") or "") or host
    return Lead(
        name=name,
        type=seg.niche_target_name or seg.niche,
        email="",
        website="https://" + host,
        city=seg.city,
        country=seg.country,
        source_url=url,
        niche_target_id=seg.niche_target_id,
        status="NO_EMAIL",
        snippet=_text(hit.get("content") or "")[:300],
    )


def queries_for_segment(seg: Segment) -> list[str]:
    """Several complementary search queries per segment — the real lead-count multiplier."""
    n, c, country = seg.niche_target_phrase, seg.city, seg.country
    raw = [
        f"{n} {c} {country}",
        f"{n} company {c}",
        f"{n} {c} kontakt impressum",
        f"{n} {c} contact email",
        f"{n} supplier {c} {country}",
    ]
    seen, out = set(), []
    for q in raw:
        k = q.lower().strip()
        if k and k not in seen:
            seen.add(k)
            out.append(q)
    return out


# --- site scraping (I/O via the injected fetcher) --------------------------

_CONTACT_HINTS = ("kontakt", "contact", "impressum", "imprint", "about", "ueber",
                  "%C3%BCber", "legal", "datenschutz", "o-nas", "kontaktyt")
# Common paths to try when the homepage + discovered links yield no email.
_GUESS_PATHS = ["/kontakt", "/contact", "/contact-us", "/contacts", "/impressum",
                "/imprint", "/about", "/about-us", "/ueber-uns", "/o-nas",
                "/kontakt.html", "/impressum.html", "/contact.html"]


def _contact_links(html: str, base: str) -> list[str]:
    """Absolute URLs of contact/impressum-looking links found on a page."""
    out, seen = [], set()
    for href in re.findall(r'href=["\']([^"\'#?]+)', html or "", re.I):
        low = href.lower()
        if not any(h in low for h in _CONTACT_HINTS):
            continue
        if href.startswith("http"):
            url = href
        elif href.startswith("/"):
            url = base + href
        else:
            url = base + "/" + href
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out[:5]


def scrape_one(fetcher, lead: Lead) -> bool:
    """Fetch a lead's site (home -> discovered contact pages -> guessed paths) and fill .email.
    Returns True if an email was recovered."""
    if lead.email or not lead.website:
        return False
    base = lead.website.rstrip("/")
    dom = registrable_domain(base)

    home = fetcher.get(base)
    email = extract_emails_from_html(home, dom) if home else ""
    if email:
        lead.email, lead.status = email, ""
        return True

    tried = {base}
    pages = _contact_links(home, base) + [base + p for p in _GUESS_PATHS]
    for url in pages:
        if url in tried:
            continue
        tried.add(url)
        html = fetcher.get(url)
        if not html:
            continue
        email = extract_emails_from_html(html, dom)
        if email:
            lead.email, lead.status = email, ""
            return True
    return False


def scrape_emails(leads: list[Lead], fetcher, workers: int = 14, cap: int = 180) -> int:
    """Concurrently scrape the websites of email-less leads. Returns count recovered.
    httpx.Client is thread-safe, so the shared fetcher is fine across the pool."""
    targets = [ld for ld in leads if not ld.email and ld.website][:max(0, cap)]
    if not targets:
        return 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        return sum(1 for ok in ex.map(lambda ld: scrape_one(fetcher, ld), targets) if ok)
