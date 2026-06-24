"""GENERIC hub / directory expansion for LEAD SATELLITE.

Web search for a niche keeps surfacing *hubs* — industry-association member lists, business
directories, "Anbieter/Mitglieder" pages — that are NOT companies themselves but LINK OUT to
dozens of the real target companies. The qualifier correctly rejects the hub as a non-company,
but the member links behind it are exactly the leads we want.

This module turns a recognised hub page into candidate company domains by reading its outbound
links. It is FULLY GENERIC / niche- and country-agnostic: it hardcodes no site, no niche and no
country — it only knows "an outbound link to an external host that looks like a real company site
(not the hub itself, not social/search/gov/marketplace junk)". Whether a given hub is worth mining
is decided UPSTREAM by the LLM classifier (entityType=directory/association + on-niche), so the
agent "thinks on its own" while searching instead of following a baked-in list.

Pure, no I/O (the caller passes already-fetched HTML), so it is trivially unit-testable.

Caveat: a hub whose member table is rendered client-side by JavaScript (e.g. a wpDataTables
widget) exposes few/no member links in the raw HTML — those need a headless render upstream.
Static and server-rendered directories (the majority) work directly.
"""
from __future__ import annotations

import re

from .scrape import is_company_host, registrable_domain

# <a href="...">inner text</a> — capture the target and the visible anchor text (the member's name).
_ANCHOR = re.compile(r'<a\b[^>]*?href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', re.I | re.S)
# Anchors that wrap a logo often embed <svg>/<style>/<script> whose text is CSS, not a name. Strip
# those blocks before reading the visible text so the member name isn't "{ fill:#fff }" garbage.
_NOISE_BLOCK = re.compile(r"<(svg|style|script)\b.*?</\1>", re.I | re.S)
_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _clean(inner: str) -> str:
    s = _NOISE_BLOCK.sub(" ", inner or "")
    s = _TAGS.sub(" ", s)
    s = s.replace("&amp;", "&").replace("&#x27;", "'").replace("&quot;", '"')
    s = re.sub(r"&[a-zA-Z#0-9]+;", " ", s)
    s = _WS.sub(" ", s).strip()[:120]
    # leftover CSS/code (e.g. ".cls-1 { fill:#000 }") is not a name -> let caller fall back to domain
    if "{" in s or "}" in s or ("(" in s and ";" in s):
        return ""
    return s


def harvest_company_links(html: str, hub_url: str, *, cap: int = 80) -> list[tuple[str, str]]:
    """Read a hub page's HTML and return [(domain, name)] for outbound links that look like real
    company sites — deduped by registrable domain, first occurrence wins (the anchor text is usually
    the member's name). Excludes the hub's own domain and any social/search/gov/marketplace host
    (via scrape.is_company_host). No niche/country logic here — that gate lives upstream."""
    hub_dom = registrable_domain(hub_url)
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for href, inner in _ANCHOR.findall(html or ""):
        if not href.lower().startswith(("http://", "https://")):
            continue                          # skip in-site relative links (nav, anchors)
        dom = registrable_domain(href)
        if not dom or dom == hub_dom or dom in seen:
            continue
        if not is_company_host(dom):
            continue                          # social/search/gov/marketplace junk
        seen.add(dom)
        out.append((dom, _clean(inner) or dom))
        if len(out) >= cap:
            break
    return out
