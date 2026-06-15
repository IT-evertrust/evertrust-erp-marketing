"""Country Profiler — port of 'Country Profiler (Local)'. For countries other than the
hardcoded PL/DE, asks the LLM for the city list + localized niche keywords; for PL/DE it
just tops up the keyword pools. Prompts verbatim. Failure -> None (PL/DE runs proceed on
built-ins; non-builtin countries then fail loudly in plan.build_plan).
"""
from __future__ import annotations

from .extract import brace_slice
from .settings import Settings

SYSTEM_PROMPT = (
    "You are a geography and B2B market research assistant. Respond with ONE valid JSON "
    "object and NOTHING ELSE. No markdown fences, no prose. Use only well-known factual knowledge."
)

USER_TEMPLATE = """Country: {country}
Niche: {niche}
Return JSON exactly in this shape: {{"countryName":"English country name","iso2":"two-letter country code","language":"main business language (English name)","langCode":"ISO 639-1 language code","cities":["city1","city2"],"nicheKeywordsLocal":"10-14 comma-separated keywords","nicheKeywordsEnglish":"10-14 comma-separated keywords"}}
Rules:
- cities = the 60 to 90 largest cities and significant business towns of this country, ordered largest first, written in their LOCAL spelling. Do not include cities of other countries.
- BOTH keyword lists must EXPAND the niche: include synonyms, ALL related sub-services, product categories and company types that a company in this niche would use to describe itself (e.g. for "{niche}": manufacturers, suppliers, installers, service providers, solutions, related technologies). The goal is to surface as MANY companies of this niche as possible.
- nicheKeywordsEnglish: in English.
- nicheKeywordsLocal: in the LOCAL language of {country}, NOT English and NOT transliterated - exactly the way local companies describe themselves on their own websites. Native script if the language uses one (e.g. Cyrillic for Bulgarian). If the local business language is English, repeat the English list."""

MAX_TRIES = 2


def profile_country(settings: Settings, country: str, niche: str, log) -> dict | None:
    if not settings.llm_base_url:
        return None
    from openai import OpenAI

    client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    user = USER_TEMPLATE.format(country=country, niche=niche)
    for _ in range(MAX_TRIES):
        try:
            response = client.chat.completions.create(
                model=settings.extract_model,
                temperature=0.2,
                max_tokens=3000,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user},
                ],
            )
        except Exception:
            continue
        parsed = brace_slice(response.choices[0].message.content)
        if parsed and isinstance(parsed.get("cities"), list):
            log(f"[V2 Profile] {parsed.get('countryName')} -> {len(parsed['cities'])} cities")
            return parsed
    log("[V2 Profile] profiler failed — proceeding on built-ins")
    return None
