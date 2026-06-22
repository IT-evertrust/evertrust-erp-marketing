"""Resolution + email verification for Lead Satellite.

- canonical_domain / is_noise_domain: turn messy search URLs into unique company
  domains and drop non-company hosts (social, marketplaces, news, directories).
- rank_emails: prefer a named person's on-domain address over a generic mailbox.
- mx_lookup / verify_email: confirm the email's domain actually accepts mail, using
  DNS-over-HTTPS (keyless, dependency-free) so we never ship a dead address.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx

from erp_agents.settings import settings

_EMAIL_SYNTAX = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

# Hosts that are never the prospect's own company site.
_NOISE = {
    "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
    "youtube.com", "tiktok.com", "pinterest.com", "xing.com",
    "wikipedia.org", "amazon.com", "amazon.de", "ebay.com", "ebay.de",
    "google.com", "bing.com", "duckduckgo.com", "yelp.com", "indeed.com",
    "wlw.de", "gelbeseiten.de", "11880.com", "europages.com", "europages.de",
    "kompass.com", "pagesjaunes.fr", "yellowpages.com", "thomasnet.com",
    "herold.at", "local.ch", "yell.com",
}
_GENERIC_LOCALPARTS = {
    "info", "kontakt", "contact", "office", "mail", "email", "hello", "service",
    "support", "sales", "vertrieb", "anfrage", "kundenservice", "post", "zentrale",
}
_DOH_ENDPOINT = "https://dns.google/resolve"


def canonical_domain(url: str) -> str | None:
    """Registrable host for dedup: lowercase netloc, strip 'www.'. None if unusable."""
    if not url:
        return None
    if "://" not in url:
        url = "http://" + url
    netloc = urlparse(url).netloc.lower().split(":")[0]
    if netloc.startswith("www."):
        netloc = netloc[4:]
    # Reject junk that isn't a hostname (must have a dot, no whitespace).
    if not netloc or " " in netloc or "." not in netloc:
        return None
    return netloc


def is_noise_domain(domain: str | None) -> bool:
    if not domain:
        return True
    if domain in _NOISE:
        return True
    # match subdomains of noise hosts too (e.g. m.facebook.com)
    return any(domain == n or domain.endswith("." + n) for n in _NOISE)


def rank_emails(emails: list[str], domain: str) -> list[str]:
    """Best-first: on-domain named person > on-domain generic > off-domain."""

    def score(email: str) -> tuple[int, int]:
        local, _, host = email.partition("@")
        on_domain = host == domain or host.endswith("." + domain) or domain.endswith("." + host)
        named = "." in local or "-" in local or local not in _GENERIC_LOCALPARTS
        return (0 if on_domain else 1, 0 if named else 1)

    return sorted(dict.fromkeys(emails), key=score)


def valid_syntax(email: str) -> bool:
    return bool(_EMAIL_SYNTAX.match(email or ""))


def mx_lookup(domain: str) -> bool:
    """True if the domain publishes an MX (or at least an A) record — accepts mail."""
    try:
        for rtype in ("MX", "A"):
            resp = httpx.get(
                _DOH_ENDPOINT,
                params={"name": domain, "type": rtype},
                headers={"Accept": "application/dns-json"},
                timeout=8,
            )
            if resp.status_code == 200 and resp.json().get("Answer"):
                return True
    except Exception:
        # On lookup failure, don't block the lead — treat as unverified (caller decides).
        return False
    return False


def verify_email(email: str) -> bool:
    """Syntax + (optionally) MX. Returns deliverability confidence as a bool."""
    if not valid_syntax(email):
        return False
    if not settings.verify_email_mx:
        return True
    return mx_lookup(email.split("@")[-1])
