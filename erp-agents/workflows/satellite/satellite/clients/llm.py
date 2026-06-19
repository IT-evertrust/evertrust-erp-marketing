"""LLM steps for Satellite — lead research + email recovery, prompts kept close to the
n8n workflow. The n8n agent calls a web_search tool in a loop; the Python port grounds the
model with results from the injected SearchGateway, then asks for strict JSON.

offline_* paths produce deterministic output for tests / --no-llm (no gateway, no network).
"""
from __future__ import annotations

import json
import re

from ..domain.models import Lead, Segment, email_status


def _extract_json(text: str):
    if not text:
        return None
    if isinstance(text, dict):
        return text
    t = str(text).strip()
    a, b = t.find("{"), t.rfind("}")
    if a >= 0 and b > a:
        t = t[a : b + 1]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        return None


def _client(settings):
    from openai import OpenAI

    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    # Hard timeout + no retries: hermes can be slow, and the SDK's 600s × 2-retry default
    # would let a single call hang the whole run for minutes. Fail fast; callers are best-effort.
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                  timeout=45.0, max_retries=0)


def _lead_from(d: dict, seg: Segment) -> Lead:
    em, status = email_status(d.get("email"))
    return Lead(
        name=str(d.get("name") or "").strip(),
        type=str(d.get("type") or "").strip(),
        email=em,
        website=str(d.get("website") or "").strip(),
        city=str(d.get("city") or seg.city).strip(),
        country=str(d.get("country") or seg.country).strip(),
        source_url=str(d.get("sourceURL") or d.get("sourceUrl") or d.get("url") or "").strip(),
        niche_target_id=seg.niche_target_id,
        status=status,
    )


def generate_buzzwords(settings, niche: str, country: str, industry: str = "", want: int = 40) -> list[str]:
    """Ask the LLM for a rich set of search buzzwords/synonyms for a niche, biased toward
    companies that bid on / supply PUBLIC TENDERS (German public sector first). EN + German.
    Returns [] on any failure so the caller falls back to the deterministic expansion."""
    if not settings.llm_base_url:
        return []
    system = (
        "You are a public-procurement market researcher. Given a niche and a target market "
        "(country), output a broad list of SEARCH BUZZWORDS to find companies that could supply "
        "or bid on PUBLIC TENDERS in that niche. Include: niche synonyms, adjacent product/service "
        "terms, and industry jargon, written in BOTH English AND the primary business language of "
        "the target country (e.g. Polish for Poland, German for Germany). Keep each buzzword 1-4 "
        "words, no geography names. Return STRICT JSON only."
    )
    user = (
        f"Parent industry: {industry or '(infer)'}\nNiche: {niche}\nTarget market: "
        f"{country or 'the target country'} (public sector / tenders)\n\nReturn JSON: {{\"buzzwords\": [\"...\"]}} "
        f"with {want}+ distinct VENDOR/COMPANY buzzwords for this niche (sub-niches + product "
        f"categories a company would use to describe ITSELF), going broad but staying on-niche, "
        f"mixing English and the local language of {country or 'the target country'}. No generic topic words and "
        f"no news/course/university/government terms. JSON only."
    )
    try:
        client = _client(settings)
        resp = client.chat.completions.create(
            model=settings.buzzword_model, temperature=0.5,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        data = _extract_json(resp.choices[0].message.content or "")
        words = data.get("buzzwords", []) if isinstance(data, dict) else []
        out, seen = [], set()
        for w in words:
            w = str(w or "").strip()
            k = w.lower()
            if w and k not in seen and len(w) <= 60:
                seen.add(k)
                out.append(w)
        return out[: max(want, 60)]
    except Exception:
        return []


def _chat_json(settings, system: str, user: str, timeout: float = 90.0) -> dict:
    """One strict-JSON chat call to the gateway. Returns the parsed dict, or {} on any failure."""
    if not settings.llm_base_url:
        return {}
    try:
        from openai import OpenAI

        client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                        timeout=timeout, max_retries=0)
        resp = client.chat.completions.create(
            model=settings.profile_model, temperature=0.2, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        d = _extract_json(resp.choices[0].message.content or "")
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _simple_cities(settings, country: str, want: int = 40) -> dict:
    """8B-friendly fallback: a FLAT city list + iso2/langCode. Small models choke on the big nested
    region->cities->keywords JSON but handle this simple shape, so the satellite still gets cities."""
    d = _chat_json(
        settings,
        "Respond with ONE valid JSON object and nothing else. Use only well-known facts.",
        f'List the largest cities of {country}. Return JSON exactly: '
        f'{{"iso2":"2-letter code","langCode":"ISO 639-1 code","cities":["city1","city2"]}} — the '
        f'{want} largest cities and business towns of {country}, LOCAL spelling, largest first. Only '
        f'cities of {country}. JSON only.')
    cities = [str(x).strip() for x in (d.get("cities") or []) if str(x).strip()]
    return {"iso2": str(d.get("iso2") or "").upper()[:2],
            "langCode": str(d.get("langCode") or "").lower()[:5], "cities": cities[:want]}


def _simple_keywords(settings, country: str, niche: str, industry: str = "") -> dict:
    """8B-friendly fallback: bilingual niche keywords (local + English) as two flat lists — so the
    niche gate speaks the local language (the big drop in off-niche results) even on a small model."""
    d = _chat_json(
        settings,
        "Respond with ONE valid JSON object and nothing else.",
        f'Industry: {industry or "(infer)"}. Niche: {niche}. Country: {country}.\n'
        f'Return JSON: {{"local":["..."],"english":["..."]}} — 10-15 search keywords a COMPANY in '
        f'this niche uses to describe what it BUILDS or SELLS (sub-niches, product categories), in '
        f'BOTH the local language of {country} (native script if it uses one) AND English. No '
        f'news / course / university / government words. JSON only.')
    return {"keywordsLocal": [str(x).strip() for x in (d.get("local") or []) if str(x).strip()],
            "keywordsEnglish": [str(x).strip() for x in (d.get("english") or []) if str(x).strip()]}


def profile_country(settings, country: str, niche: str, industry: str = "", want_cities: int = 80) -> dict:
    """Country profiler (port of the n8n 'Country Profiler' node). For ANY country + niche, ask the
    model for that country's real ADMINISTRATIVE REGIONS each with its cities (local spelling) +
    BILINGUAL niche keywords (local script + English). The regions drive the nationwide per-region
    sweep, so the satellite is fully country-agnostic with NO hardcoded geography. Returns {} on any
    failure so callers fall back to the offline PL/DE fixtures + deterministic keywords."""
    if not settings.llm_base_url:
        return {}
    system = ("You are a geography and B2B market research assistant. Respond with ONE valid JSON "
              "object and NOTHING ELSE. No markdown fences, no prose. Use only well-known facts.")
    user = (
        f"Country: {country}\nParent industry: {industry or '(infer from the niche)'}\nNiche: {niche}\n"
        'Return JSON exactly in this shape: {"countryName":"English country name",'
        '"iso2":"two-letter country code","language":"main business language (English name)",'
        '"langCode":"ISO 639-1 code",'
        '"regions":[{"name":"administrative region name (local spelling)","cities":["city1","city2"]}],'
        '"nicheKeywordsLocal":"10-14 comma-separated keywords",'
        '"nicheKeywordsEnglish":"10-14 comma-separated keywords"}\nRules:\n'
        "- regions = the FIRST-LEVEL administrative divisions of THIS specific country (states / "
        "provinces / voivodeships / Bundesländer / counties / regions / prefectures / oblasts — "
        "whatever THIS country actually uses). List the COMPLETE set (most countries have 5-30; do "
        "NOT stop after a few), in LOCAL spelling. This MUST work for ANY country on earth: never "
        "restrict to a fixed set, never include divisions of another country, and never invent a "
        "region that does not exist.\n"
        "- For EACH region: cities = 3 to 10 of its largest cities / business towns (local spelling, "
        "largest first). Together the regions should cover the whole country.\n"
        "- BOTH keyword lists EXPAND the niche WIDE but stay ON-NICHE and COMMERCIAL. Within the "
        "parent industry, include sub-niches, adjacent product/service categories, the core "
        "technologies, and the exact words a COMPANY/VENDOR uses to describe what it BUILDS or SELLS "
        "(e.g. for 'AI Platform' under IT: MLOps, model serving, machine-learning platform, AI "
        "infrastructure, data platform, vector database, computer vision, NLP, AI software/SaaS "
        "vendor). The SAME broad-but-on-niche expansion applies to EVERY niche and industry — "
        "lighting, construction, logistics, manufacturing, energy, anything — not only tech. Go BROAD "
        "across the whole niche, but EVERY term must identify a COMPANY/VENDOR that makes or sells in "
        "it, NOT a generic topic word, and NEVER words that pull in news, blogs, courses or training, "
        "universities or government (those are not leads).\n"
        "- nicheKeywordsEnglish: in English.\n"
        f"- nicheKeywordsLocal: in the LOCAL language of {country}, native script if the language "
        "uses one (e.g. Cyrillic for Bulgarian), exactly how local companies describe themselves on "
        "their own websites. If the local business language is English, repeat the English list."
    )

    def _split(v):
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return [s.strip() for s in str(v or "").split(",") if s.strip()]

    try:
        from openai import OpenAI

        # One upfront call that produces a long list (cities + keywords) — give it a generous
        # timeout (vs _client's fail-fast 45s used for the many per-segment calls).
        client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                        timeout=120.0, max_retries=0)
        resp = client.chat.completions.create(
            model=settings.profile_model, temperature=0.3,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        data = _extract_json(resp.choices[0].message.content or "")
        if not isinstance(data, dict):
            return {}
        regions, flat_cities = [], []
        for r in (data.get("regions") if isinstance(data.get("regions"), list) else []):
            if not isinstance(r, dict):
                continue
            rc = _split(r.get("cities"))
            if rc:
                regions.append({"name": str(r.get("name") or ""), "cities": rc})
                flat_cities.extend(rc)
        out = {
            "countryName": str(data.get("countryName") or country),
            "iso2": str(data.get("iso2") or "").upper()[:2],
            "language": str(data.get("language") or ""),
            "langCode": str(data.get("langCode") or "").lower()[:5],
            "regions": regions,
            "cities": (flat_cities or _split(data.get("cities")))[:want_cities],
            "keywordsLocal": _split(data.get("nicheKeywordsLocal")),
            "keywordsEnglish": _split(data.get("nicheKeywordsEnglish")),
        }
    except Exception:
        out = {"countryName": country, "iso2": "", "language": "", "langCode": "",
               "regions": [], "cities": [], "keywordsLocal": [], "keywordsEnglish": []}

    # SMALL-MODEL FALLBACK (hermes-mini 8B chokes on the big nested JSON above). If the rich call
    # produced no geography / no keywords, recover them with SIMPLE flat calls the 8B can answer.
    if not out["regions"] and not out["cities"]:
        sc = _simple_cities(settings, country, want_cities)
        if sc.get("cities"):
            out["cities"] = sc["cities"]
            out["iso2"] = out["iso2"] or sc.get("iso2", "")
            out["langCode"] = out["langCode"] or sc.get("langCode", "")
    if not out["keywordsLocal"] and not out["keywordsEnglish"]:
        kw = _simple_keywords(settings, country, niche, industry)
        out["keywordsLocal"] = kw["keywordsLocal"]
        out["keywordsEnglish"] = kw["keywordsEnglish"]
    # Nothing usable at all -> behave like the old failure (caller falls back to offline tables).
    return out if (out["cities"] or out["regions"] or out["keywordsLocal"] or out["keywordsEnglish"]) else {}


def research_leads(settings, seg: Segment, search) -> list[Lead]:
    hits = []
    try:
        hits = search.query(f"{seg.niche} companies {seg.city} {seg.country}")[:8]
    except Exception:
        hits = []
    grounding = "\n".join(f"- {h.get('title','')} | {h.get('url','')} | {h.get('content','')}" for h in hits)
    client = _client(settings)
    resp = client.chat.completions.create(
        model=settings.lead_model,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": seg.system_content},
            {"role": "user", "content": seg.user_content + ("\n\nSearch results:\n" + grounding if grounding else "")},
        ],
    )
    data = _extract_json(resp.choices[0].message.content or "")
    leads = data.get("leads", []) if isinstance(data, dict) else []
    return [_lead_from(d, seg) for d in leads if isinstance(d, dict) and (d.get("name"))]


def recover_emails(settings, companies: list[dict], search) -> dict:
    """companies: [{id, name, website, city, country}] -> {id: email}."""
    if not companies:
        return {}
    client = _client(settings)
    lines = [f"{c['id']} | {c['name']} | {c.get('website') or '(no website)'} | {c.get('city','')}, {c.get('country','')}"
             for c in companies]
    system = ("You are a relentless B2B contact researcher. For EACH company find its REAL public "
              "business email (impressum/kontakt/contact, directories, LinkedIn, trade register). "
              "NEVER invent an address. Return STRICT JSON only.")
    user = ("Find the public business email for EACH company below.\nFormat per line: "
            "ID | NAME | WEBSITE | CITY, COUNTRY\n\n" + "\n".join(lines) +
            '\n\nReturn JSON: {"emails":[{"id":0,"email":"found@domain.com"}]} - empty string only if '
            "unverifiable. JSON only.")
    resp = client.chat.completions.create(
        model=settings.email_model, temperature=0.1, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    data = _extract_json(resp.choices[0].message.content or "")
    out = {}
    for e in (data.get("emails", []) if isinstance(data, dict) else []):
        if isinstance(e, dict) and "id" in e:
            em, status = email_status(e.get("email"))
            if em and status == "":
                out[int(e["id"])] = em
    return out


# --- offline (deterministic) paths -----------------------------------------

def offline_research(seg: Segment) -> list[Lead]:
    slug = re.sub(r"[^a-z0-9]", "", seg.city.lower()) or "city"
    nslug = re.sub(r"[^a-z0-9]", "", seg.niche_target_phrase.lower()) or "co"
    name = f"{seg.niche_target_phrase.title()} {seg.city} GmbH"
    return [Lead(
        name=name, type=seg.niche_target_name or seg.niche, email=f"info@{nslug}-{slug}.example",
        website=f"https://{nslug}-{slug}.example", city=seg.city, country=seg.country,
        source_url=f"https://{nslug}-{slug}.example", niche_target_id=seg.niche_target_id, status="",
        source="offline", segment=f"{seg.niche_target_name or seg.niche} @ {seg.city}".strip(),
    )]


def offline_recover(companies: list[dict]) -> dict:
    return {}
