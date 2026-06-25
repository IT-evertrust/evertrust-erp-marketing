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


def classify_company(settings, name: str, url: str, text: str, niche: str, country: str = "",
                     *, model: str | None = None, timeout: float = 45.0) -> dict:
    """LANGUAGE-AGNOSTIC entity + niche-fit judgement on a crawled page. The LLM reads the page in
    whatever language it's in (Polish, German, …), so there are NO hardcoded per-language word lists.

    Returns {'entityType','nicheFit','reason'} or {} on any failure (the caller then falls back to
    the universal structural rules). entityType ∈ company|event|association|government|education|
    news|jobboard|directory|training; nicheFit ∈ core|peripheral|none."""
    if not settings.llm_base_url:
        return {}
    system = (
        "You classify ONE business website from its visible text, in ANY language. Output STRICT "
        "JSON only, no prose. Decide two things:\n"
        "entityType — one of: company, event, association, government, education, news, jobboard, "
        "directory, training. 'company' = a real commercial business that sells products/services "
        "(a possible B2B sales prospect). The others are NOT prospects (an event page, an industry "
        "association/initiative, a public authority, a university/school, a news/blog article, a job "
        "board, a business directory/marketplace, or a training/course provider).\n"
        "nicheFit — how central the given NICHE is to this entity: 'core' (it is their main "
        "business), 'peripheral' (a related sub-area among others), or 'none' (unrelated)."
    )
    user = (f'NICHE: "{niche}"\nCOUNTRY: {country}\nCOMPANY NAME: {name}\nURL: {url}\n'
            f'VISIBLE PAGE TEXT:\n{(text or "")[:4000]}\n\n'
            'Return JSON exactly: {"entityType":"...","nicheFit":"core|peripheral|none","reason":"<=8 words"}')
    try:
        from openai import OpenAI
        # Own client with a caller-set timeout: a big local model (qwen2.5:32b) can need a one-time
        # cold VRAM load (~30s) before its first classify, so 45s is too tight -> silent {} fallback.
        client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                        timeout=timeout, max_retries=0)
        r = client.chat.completions.create(
            model=model or settings.lead_model, temperature=0,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
        d = _extract_json(r.choices[0].message.content)
    except Exception:
        return {}
    return d if isinstance(d, dict) else {}


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


def profile_country(settings, country: str, niche: str, industry: str = "", want_cities: int = 80,
                    zone: str = "") -> dict:
    """Country profiler (port of the n8n 'Country Profiler' node). For ANY country + niche, ask the
    model for that country's real ADMINISTRATIVE REGIONS each with its cities (local spelling) +
    BILINGUAL niche keywords (local script + English). The regions drive the nationwide per-region
    sweep, so the satellite is fully country-agnostic with NO hardcoded geography. Returns {} on any
    failure so callers fall back to the offline PL/DE fixtures + deterministic keywords.

    `zone` (AIM region: North/South/East/West/Central or 'Near border (DE-PL)') restricts Round 3 to
    the regions in that part of the country / along that border — still LLM-driven, no geo tables."""
    if not settings.llm_base_url:
        return {}
    # Profiling is split into small focused ROUNDS below (one giant call timed out / left geo blank
    # on slow models). Each round asks for ONE thing so the model fills it reliably and fast.
    def _split(v):
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return [s.strip() for s in str(v or "").split(",") if s.strip()]

    def _ask(user_prompt, timeout,
             system_p="Return ONE valid JSON object and NOTHING ELSE. No prose, no markdown."):
        try:
            from openai import OpenAI
            client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                            timeout=timeout, max_retries=0)
            r = client.chat.completions.create(
                model=settings.profile_model, temperature=0.2,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": system_p},
                          {"role": "user", "content": user_prompt}])
            d = _extract_json(r.choices[0].message.content or "")
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}

    # Round 1 - country code + business language: tiny, near-instant, reliable for ANY country.
    g = _ask(f'For the country "{country}" return JSON: '
             '{"iso2":"ISO 3166-1 alpha-2 code","language":"main business language (English name)",'
             '"langCode":"ISO 639-1 two-letter code"}', 45)
    iso2 = str(g.get("iso2") or "").upper()[:2]
    lang_code = str(g.get("langCode") or "").lower()[:5]

    # Round 2 - bilingual niche keywords (on-niche, commercial; NO geography in this call).
    kw = _ask(
        f'Niche: "{niche}"\nParent industry: {industry or "(infer from the niche)"}\nCountry: {country}\n'
        'Return JSON: {"keywordsLocal":[...],"keywordsEnglish":[...]}. Each list = 10-14 SEARCH '
        'keywords a COMPANY/VENDOR in this niche uses to describe what it BUILDS or SELLS (sub-niches, '
        'product/service categories, core technologies). Commercial only - NEVER words that pull in '
        'news, blogs, courses, training, universities or government. keywordsEnglish in English; '
        f'keywordsLocal in the local language of {country} (native script), exactly how local '
        'companies describe themselves; if the local business language is English, repeat the list.',
        70)
    kw_local = _split(kw.get("keywordsLocal") or kw.get("nicheKeywordsLocal"))
    kw_en = _split(kw.get("keywordsEnglish") or kw.get("nicheKeywordsEnglish"))

    # Round 3 - the country's first-level administrative regions (NAMES only -> short output).
    # Zone-aware: an AIM zone restricts to that part of the country / that border instead of all.
    if str(zone or "").strip():
        rg = _ask(f'Country: "{country}". Zone requested: "{zone}". List ONLY the FIRST-LEVEL '
                  'administrative regions (states / provinces / voivodeships / Bundeslaender / regions) '
                  'that lie in that zone of the country — a compass word (North/South/East/West/Central) '
                  'means that part of the country; a "near border (XX-YY)" zone means the regions running '
                  'along that international border. Local spelling. Return JSON: '
                  '{"regions":["name1","name2",...]}. Never invent one or use another country\'s.', 60)
    else:
        rg = _ask(f'List the COMPLETE set of FIRST-LEVEL administrative regions of "{country}" (states / '
                  'provinces / voivodeships / Bundeslaender / regions / oblasts - whatever THIS country '
                  'actually uses), local spelling, every one (most countries have 5-30). Return JSON: '
                  '{"regions":["name1","name2",...]}. Never invent one or use another country\'s.', 60)
    region_names = _split(rg.get("regions"))[:30]

    # Round 4 - cities per region, in small concurrent BATCHES (short output each, can't time out).
    regions, flat_cities = [], []
    if region_names:
        from concurrent.futures import ThreadPoolExecutor
        batches = [region_names[i:i + 6] for i in range(0, len(region_names), 6)]

        # cities to ask for PER REGION = the overall ceiling spread across the regions (min 8), so a
        # high want_cities actually pulls in 2nd/3rd-tier towns instead of just the top few.
        per_region = max(8, -(-want_cities // max(1, len(region_names))))

        def _cities(batch):
            d = _ask(f'Country: {country}. For EACH region below list up to {per_region} of its largest '
                     'cities / business towns (local spelling, largest first, no duplicates). Regions: '
                     + "; ".join(batch) +
                     '\nReturn JSON mapping each region name to its city list: '
                     '{"<region>":["city1","city2",...]}.', 90)
            return [(name, _split(d.get(name))) for name in batch]

        with ThreadPoolExecutor(max_workers=3) as ex:
            for pairs in ex.map(_cities, batches):
                for name, cities in pairs:
                    if cities:
                        regions.append({"name": name, "cities": cities})
                        flat_cities.extend(cities)

    out = {
        "countryName": str(g.get("countryName") or country), "iso2": iso2,
        "language": str(g.get("language") or ""), "langCode": lang_code,
        "regions": regions, "cities": flat_cities[:want_cities],
        "keywordsLocal": kw_local, "keywordsEnglish": kw_en,
    }
    # Usable if ANY round produced something — geo language + market TLD survive even with no regions.
    return out if (iso2 or kw_local or kw_en or flat_cities) else {}


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
