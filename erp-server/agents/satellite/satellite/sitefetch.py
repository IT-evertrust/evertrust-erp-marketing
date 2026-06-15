"""Candidate site fetching + prep — port of 'Fetch Homepage' / 'Prep Candidates' /
'Fetch Contact Page' / 'Mine Contact Emails'.

Dead-domain rule (verbatim): DNS/TLS-level failures remove the candidate entirely;
HTTP-level failures (403, timeout) keep it with alive=False and the SERP snippet as its
page text. Contact page is fetched only when the homepage yielded 0 emails, a contact-ish
link exists, and the site is alive — with the 8s time cap.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

import httpx

from .emails import harvest_emails
from .serp import Candidate
from .settings import ACCEPT_LANG, UA, Settings

_DEAD_RE = re.compile(r"ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT_|ERR_TLS|getaddrinfo", re.I)
_TITLE_RE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.I)
_META_RE = re.compile(r'<meta[^>]+name="description"[^>]+content="([^"]*)"', re.I)
_CONTACT_RE = re.compile(r'href="([^"]*(?:kontakt|contact|impressum|o-nas|about)[^"]*)"', re.I)
_SCRIPT_RE = re.compile(r"<(script|style|noscript)[\s\S]*?</\1>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_ENTITY_RE = re.compile(r"&[a-z#0-9]+;", re.I)
CF_MARK_RE = re.compile(r"cfemail|email-protection", re.I)


def _page_text(html: str, limit: int = 2200) -> str:
    txt = _SCRIPT_RE.sub(" ", html or "")
    txt = _TAG_RE.sub(" ", txt)
    txt = _ENTITY_RE.sub(" ", txt)
    return re.sub(r"\s+", " ", txt).strip()[:limit]


def _resolve_contact_url(href: str, domain: str) -> str:
    href = (href or "").split("#")[0]
    if not href:
        return ""
    if href.startswith("http"):
        return href
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return f"https://{domain}{href}"
    return f"https://{domain}/{href}"


def _classify_error(exc: Exception) -> str:
    """Map httpx exceptions onto the n8n dead-domain marker strings."""
    if isinstance(exc, httpx.ConnectError):
        msg = str(exc)
        if "SSL" in msg or "certificate" in msg.lower():
            return "CERT_ERROR"
        return "ENOTFOUND"
    if isinstance(exc, httpx.ConnectTimeout):
        return "TIMEOUT"
    return type(exc).__name__


def _fetch_one(candidate: Candidate, settings: Settings) -> tuple[Candidate, str, str]:
    headers = {"User-Agent": UA, "Accept-Language": ACCEPT_LANG}
    try:
        with httpx.Client(headers=headers, follow_redirects=True) as client:
            r = client.get(candidate.url, timeout=settings.homepage_timeout_s)
            return candidate, r.text, ""
    except Exception as exc:
        return candidate, "", _classify_error(exc)


def prep_candidates(candidates: list[Candidate], settings: Settings, log) -> list[Candidate]:
    """Fetch homepages concurrently, drop dead domains, extract title/meta/text/emails/
    contact link, then run the contact-page fallback for email-less alive sites."""
    kept: list[Candidate] = []
    needs_contact: list[Candidate] = []

    with ThreadPoolExecutor(max_workers=settings.fetch_workers) as pool:
        results = pool.map(lambda c: _fetch_one(c, settings), candidates)
        for cand, html, error in results:
            if not html and _DEAD_RE.search(error or ""):
                continue  # dead domain — remove entirely
            if not html:
                cand.alive = False
                cand.page_text = cand.snippet
                kept.append(cand)
                continue
            tm = _TITLE_RE.search(html)
            mm = _META_RE.search(html)
            cand.page_title = (tm.group(1).strip() if tm else "")[:150]
            cand.meta_desc = (mm.group(1).strip() if mm else "")[:250]
            cand.page_text = _page_text(html)
            cand.cf_protected = bool(CF_MARK_RE.search(html))
            cand.emails = harvest_emails(html, cand.domain)
            cm = _CONTACT_RE.search(html)
            cand.contact_url = _resolve_contact_url(cm.group(1) if cm else "", cand.domain)
            kept.append(cand)
            if not cand.emails and cand.contact_url and cand.alive:
                needs_contact.append(cand)

    if not kept:
        raise SystemExit(
            "V2 PREP EMPTY: every candidate domain was dead - search results were junk"
        )
    log(f"[V2 Prep] {len(candidates)} fetched -> {len(kept)} kept, "
        f"{len(needs_contact)} need contact page")

    if needs_contact:
        headers = {"User-Agent": UA}
        with ThreadPoolExecutor(max_workers=settings.fetch_workers) as pool:
            def mine(cand: Candidate) -> None:
                try:
                    with httpx.Client(headers=headers, follow_redirects=True) as client:
                        r = client.get(cand.contact_url, timeout=settings.contact_timeout_s)
                        html = r.text
                except Exception:
                    return
                found = harvest_emails(html, cand.domain)
                if found:
                    cand.emails = found
                if CF_MARK_RE.search(html):
                    cand.cf_protected = True

            list(pool.map(mine, needs_contact))
        log(f"[V2 Contact] mined {sum(1 for c in needs_contact if c.emails)} "
            f"of {len(needs_contact)} contact pages")

    return kept
