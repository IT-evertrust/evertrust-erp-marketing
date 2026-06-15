"""SERP layer: engine URLs, fetching, per-engine parsing, junk filtering, candidate
collection with domain dedup, and the one-shot retry-on-next-engine rule.

Parsers are verbatim ports of the n8n parseSerp regexes (no BeautifulSoup — fidelity
to the proven extraction over elegance). One SERP page per query, never paginated.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
from dataclasses import dataclass, field

import httpx

from .plan import Plan, PlannedQuery
from .settings import ACCEPT_LANG, UA, Settings

JUNK = [
    "google.", "duckduckgo.", "mojeek.", "facebook.", "instagram.", "youtube.", "linkedin.",
    "wikipedia.", "twitter.", "x.com", "pinterest.", "allegro.", "olx.", "amazon.", "booking.",
    "tripadvisor.", "yelp.", "panoramafirm.pl", "pkt.pl", "aleo.com", "rejestr.io",
    "gelbeseiten.de", "11880.com", "dastelefonbuch.de", "wlw.de", "kompass.com", "europages.",
    "pracuj.pl", "indeed.", "glassdoor.", "kununu.", "gowork.", "money.pl", "bankier.",
    "onet.", "wp.pl", "interia.", "gazeta.", "olx.pl", "ceneo.", "oferteo.", "fixly.",
    "firmy.net", "baza-firm", "krs-online", "nip24", "mapa.", "jobs.", "praca.", ".gov",
    "gov.pl", "edu.pl", "bip.", "sejm.", "nfz.", "clutch.co", "goodfirms", "sortlist",
    "designrush", "themanifest", "justjoin.it", "nofluffjobs", "bulldogjob", "rocketjobs",
    "wykop.", "reddit.", "medium.", "github.", "behance.", "dribbble.", "theorg.com",
    "freelancermap", "railsgirls", "upwork.", "fiverr.",
]

NICHE_BLOCK = [
    "uzdrowisko", "sanatorium", "health resort", "hotel", "hostel", "pensjonat", "restauracja",
    "restaurant", "szpital", "hospital", "klinika", "muzeum", "museum", "biblioteka",
    "przedszkole", "uniwersytet", "university", "hochschule", "kosciol", "parafia", "urzad",
    "starostwo", "nieruchomosci", "real estate", "biuro podrozy", "kancelaria", "apteka",
    "pharmacy", "instytut", "institut", "fundacja", "foundation", "stowarzyszenie",
    "politechnika", "akademia", "uczelnia", "wikipedia", "blog", "aktualnosci", "news",
    "ranking", "top 10", "lista", "non-profit", "nonprofit", "volunteer", "community",
    "marketplace", "job portal", "portal pracy",
]

_DDG_RE = re.compile(
    r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>'
)
_MOJEEK_TITLE_RE = re.compile(r'class="title"[^>]*href="(https?://[^"]+)"[^>]*>([\s\S]*?)</a>')
_MOJEEK_SNIP_RE = re.compile(r'<p class="s">([\s\S]*?)</p>')
_TAG_RE = re.compile(r"<[^>]+>")


@dataclass
class Candidate:
    id: str
    domain: str
    url: str
    name_guess: str
    city: str
    country: str
    snippet: str
    hits: int = 1
    # filled by the fetch/prep stage:
    alive: bool = True
    page_title: str = ""
    meta_desc: str = ""
    page_text: str = ""
    cf_protected: bool = False
    emails: list[str] = field(default_factory=list)
    contact_url: str = ""


def normalize_domain(u: str) -> str:
    d = str(u or "").strip().lower()
    if "://" in d:
        d = d.split("://", 1)[1]
    if d.startswith("www."):
        d = d[4:]
    return d.split("/")[0].split("?")[0]


def strip_tags(s: str) -> str:
    return _TAG_RE.sub(" ", s or "").strip()


def build_url(engine: str, q: str, *, searxng_url: str, lang_code: str, ddg_kl: str) -> str:
    if engine == "searxng" and searxng_url:
        return f"{searxng_url}/search?format=json&q={urllib.parse.quote(q)}&language={lang_code}"
    if engine == "mojeek":
        return f"https://www.mojeek.com/search?q={urllib.parse.quote(q)}"
    return f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(q)}&kl={ddg_kl}"


def parse_serp(body: str, engine: str) -> list[dict]:
    """Returns [{url, title, snip}] — verbatim regex logic per engine."""
    out: list[dict] = []
    if not body:
        return out
    if engine == "searxng":
        try:
            px = json.loads(body)
            for r in px.get("results", []):
                out.append({
                    "url": r.get("url", ""),
                    "title": str(r.get("title", "")),
                    "snip": str(r.get("content", ""))[:250],
                })
        except (json.JSONDecodeError, AttributeError):
            pass
        return out
    if engine == "mojeek":
        blocks = body.split("<!--rs-->")[1:]
        for blk in blocks:
            hm = _MOJEEK_TITLE_RE.search(blk)
            if not hm:
                continue
            sm = _MOJEEK_SNIP_RE.search(blk)
            out.append({"url": hm.group(1), "title": hm.group(2), "snip": (sm.group(1)[:250] if sm else "")})
        return out
    # DuckDuckGo html.duckduckgo.com
    for m in _DDG_RE.finditer(body):
        href = m.group(1)
        um = re.search(r'uddg=([^&"]+)', href)
        if um:
            try:
                href = urllib.parse.unquote(um.group(1))
            except Exception:
                pass
        out.append({"url": href, "title": m.group(2), "snip": ""})
    return out


def _keep(result: dict) -> str:
    """Return normalized domain if the result passes all filters, else ''."""
    url = result.get("url", "")
    if not url.startswith("http"):
        return ""
    dom = normalize_domain(url)
    if "." not in dom:
        return ""
    for j in JUNK:
        if j in dom:
            return ""
    haystack = (strip_tags(result.get("title", "")) + " " + dom).lower()
    for b in NICHE_BLOCK:
        if b in haystack:
            return ""
    return dom


def _fetch(client: httpx.Client, url: str, timeout: float) -> str:
    try:
        r = client.get(url, timeout=timeout)
        if r.status_code == 200:
            return r.text
    except httpx.HTTPError:
        pass
    return ""


def collect_candidates(
    settings: Settings, plan: Plan, log, id_offset: int = 0
) -> dict[str, Candidate]:
    """Search round 1 + per-query retry-on-next-engine. Returns domain -> Candidate.

    Retry rule (verbatim from n8n): a query that produced 0 kept results is re-issued
    once on the NEXT engine in the rotation; retry finds dedup against round-1 domains
    and get ids starting at c100001.
    """
    headers = {"User-Agent": UA, "Accept-Language": ACCEPT_LANG}
    cands: dict[str, Candidate] = {}
    retries: list[PlannedQuery] = []
    order = id_offset

    def absorb(pq: PlannedQuery, results: list[dict], id_base: int) -> int:
        nonlocal order
        kept = 0
        for r in results:
            dom = _keep(r)
            if not dom:
                continue
            kept += 1
            if dom in cands:
                c = cands[dom]
                c.hits += 1
                extra = strip_tags(r.get("snip", ""))[:250]
                if extra and extra not in c.snippet:
                    c.snippet = (c.snippet + " " + extra)[:280]
            else:
                order += 1
                title = strip_tags(r.get("title", ""))
                cands[dom] = Candidate(
                    id=f"c{id_base + order}",
                    domain=dom,
                    url=f"https://{dom}/",
                    name_guess=re.split(r"[|–—-]", title)[0].strip()[:80],
                    city=pq.city,
                    country=plan.country_name,
                    snippet=strip_tags(r.get("snip", ""))[:280],
                )
        return kept

    with httpx.Client(headers=headers, follow_redirects=True) as client:
        for i, pq in enumerate(plan.queries):
            url = build_url(pq.engine, pq.query, searxng_url=settings.searxng_url,
                            lang_code=plan.lang_code, ddg_kl=plan.ddg_kl)
            body = _fetch(client, url, settings.serp_timeout_s)
            kept = absorb(pq, parse_serp(body, pq.engine), id_base=0)
            if kept == 0:
                nxt = plan.engines[(plan.engines.index(pq.engine) + 1) % len(plan.engines)]
                retries.append(PlannedQuery(query=pq.query, engine=nxt, city=pq.city))
            if i + 1 < len(plan.queries):
                time.sleep(settings.serp_delay_s)
        log(f"[V2 Search R1] {len(plan.queries)} queries -> {len(cands)} candidates, "
            f"{len(retries)} to retry")

        if not cands and not retries:
            raise SystemExit(
                f"V2 SEARCH FAILED: all {len(plan.queries)} queries returned nothing "
                "and no retry possible"
            )

        order = 0
        for i, pq in enumerate(retries):
            url = build_url(pq.engine, pq.query, searxng_url=settings.searxng_url,
                            lang_code=plan.lang_code, ddg_kl=plan.ddg_kl)
            body = _fetch(client, url, settings.serp_timeout_s)
            absorb(pq, parse_serp(body, pq.engine), id_base=100000)
            if i + 1 < len(retries):
                time.sleep(settings.serp_delay_s)
        if retries:
            log(f"[V2 Retry] {len(retries)} retried -> {len(cands)} candidates total")

    return cands


def gate_candidates(cands: dict[str, Candidate], max_candidates: int, log) -> list[Candidate]:
    if not cands:
        raise SystemExit(
            "V2 SEARCH FAILED: 0 candidates after engine retry round - "
            "all engines blocked or keywords too narrow"
        )
    ordered = sorted(cands.values(), key=lambda c: -c.hits)[:max_candidates]
    log(f"[V2 Gate] {len(cands)} unique domains -> {len(ordered)} gated")
    return ordered
