"""Site scraping for Lead Satellite — turn a company domain into real contact data.

Pure-ish helpers + a `scrape_site` orchestrator. Stdlib only (regex over raw HTML):
no browser, no JS rendering — fine for the static contact/imprint pages that hold
the data we want. Every function degrades to empty/None on error; the caller treats
a site that won't yield contacts as simply skipped.
"""

from __future__ import annotations

import html as html_mod
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpx

from erp_agents.settings import settings
from erp_agents.workflows.reach.lead_satellite.locale import LocaleProfile

_TAGS = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_ALLTAGS = re.compile(r"<[^>]+>")
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_MAILTO = re.compile(r'href=["\']mailto:([^"\'?]+)', re.IGNORECASE)
_TEL = re.compile(r'href=["\']tel:([^"\']+)', re.IGNORECASE)
_PHONE = re.compile(r"(?:\+?\d[\d\s().\-/]{6,}\d)")
_LINK = re.compile(r'<a[^>]+href=["\'](?P<href>[^"\'#]+)["\'][^>]*>(?P<text>.*?)</a>', re.DOTALL | re.IGNORECASE)
_ROLE = re.compile(
    r"(?:Gesch[äa]ftsf[üu]hr(?:er|erin)?|Managing Director|Inhaber(?:in)?|"
    r"CEO|Owner|Director|G[ée]rant|Propri[ée]taire)\s*[:\-]?\s*"
    r"(?:Herr |Frau |Mr\.? |Ms\.? |Mrs\.? )?"
    r"(?P<name>[A-ZÄÖÜ][\wÀ-ÿ.\-]+(?:\s+[A-ZÄÖÜ][\wÀ-ÿ.\-]+){1,2})"
)


@dataclass
class SiteContacts:
    domain: str
    emails: list[str] = field(default_factory=list)
    phone: str | None = None
    contact_name: str | None = None
    contact_page: str | None = None
    text_sample: str = ""  # visible text for the LLM qualifier


def _deobfuscate(text: str) -> str:
    """Undo common email obfuscation before regex extraction."""
    text = html_mod.unescape(text)
    text = re.sub(r"\s*[\[(]\s*at\s*[\])]\s*", "@", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+at\s+", "@", text)  # "info at domain" — loose but useful
    text = re.sub(r"\s*[\[(]\s*dot\s*[\])]\s*", ".", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+dot\s+", ".", text)
    return text


def visible_text(html: str) -> str:
    no_scripts = _TAGS.sub(" ", html)
    return re.sub(r"\s+", " ", html_mod.unescape(_ALLTAGS.sub(" ", no_scripts))).strip()


def extract_emails(html: str) -> list[str]:
    found: list[str] = []
    for m in _MAILTO.finditer(html):
        found.append(m.group(1).strip().lower())
    for m in _EMAIL.finditer(_deobfuscate(html)):
        found.append(m.group(0).strip().lower())
    # dedup preserving order; drop obvious asset/placeholder addresses
    seen: set[str] = set()
    out: list[str] = []
    for e in found:
        if e in seen or any(e.endswith(ext) for ext in (".png", ".jpg", ".gif", ".svg", ".webp")):
            continue
        if e.startswith(("example@", "name@", "your@", "email@")):
            continue
        seen.add(e)
        out.append(e)
    return out


def extract_phone(html: str) -> str | None:
    m = _TEL.search(html)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    m = _PHONE.search(visible_text(html))
    return m.group(0).strip() if m else None


def extract_contact_name(text: str) -> str | None:
    m = _ROLE.search(text)
    return m.group("name").strip() if m else None


def find_contact_url(home_html: str, base_url: str, locale: LocaleProfile) -> str | None:
    """Prefer an in-page link whose anchor text looks like a contact/imprint link."""
    for m in _LINK.finditer(home_html):
        label = visible_text(m.group("text")).lower()
        href = m.group("href").strip()
        if any(lbl in label for lbl in locale.contact_link_labels) or any(
            lbl in href.lower() for lbl in locale.contact_link_labels
        ):
            return urljoin(base_url, href)
    return None


def fetch(url: str) -> str | None:
    try:
        resp = httpx.get(
            url,
            headers={"User-Agent": settings.scrape_user_agent, "Accept-Language": "*"},
            timeout=settings.scrape_timeout,
            follow_redirects=True,
        )
        ctype = resp.headers.get("content-type", "")
        if resp.status_code == 200 and "html" in ctype:
            return resp.text
    except Exception:
        return None
    return None


def scrape_site(domain: str, locale: LocaleProfile) -> SiteContacts:
    """Fetch homepage + best contact/imprint page; merge extracted contact data."""
    result = SiteContacts(domain=domain)
    base = f"https://{domain}"
    home = fetch(base) or fetch(f"http://{domain}")
    if not home:
        return result

    result.text_sample = visible_text(home)[:1500]
    pages_html = [home]

    # Find the contact/imprint page: prefer a discovered link, then probe known paths.
    contact_url = find_contact_url(home, base, locale)
    tried: set[str] = set()
    candidates = [contact_url] if contact_url else []
    candidates += [base + p for p in locale.contact_paths]
    for cu in candidates:
        if not cu or cu in tried:
            continue
        tried.add(cu)
        # Only follow links on the same registrable host.
        if urlparse(cu).netloc and domain not in urlparse(cu).netloc:
            continue
        page = fetch(cu)
        if page:
            result.contact_page = cu
            pages_html.append(page)
            break

    merged = "\n".join(pages_html)
    result.emails = [e for e in extract_emails(merged) if e.split("@")[-1] not in {""}]
    result.phone = extract_phone(merged)
    result.contact_name = extract_contact_name(visible_text(merged))
    return result
