"""Search-plan construction — port of 'Build Search Plan'.

Plan = one query per (city x queriesPerCity), query text "<keyword> <city>", keyword
cycling through the merged pool, engine round-robin across ALL queries (searxng weighted
2x when configured). Loud config failures match the n8n error strings.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import geo, keywords


@dataclass(frozen=True)
class PlannedQuery:
    query: str
    engine: str  # 'searxng' | 'ddg' | 'mojeek'
    city: str


@dataclass(frozen=True)
class Plan:
    queries: list[PlannedQuery]
    engines: list[str]
    cc: str            # 'PL' | 'DE' | '' (profiled country)
    country_name: str
    lang_code: str
    ddg_kl: str
    niche: str
    keywords: list[str]
    cities: list[str]


def build_plan(
    *,
    niche: str,
    country: str,
    region: str,
    profiler: dict | None,
    searxng_url: str,
    queries_per_city: int = 2,
    max_queries: int = 600,
    max_cities: int = 0,
) -> Plan:
    cc = geo.resolve_builtin(country)
    prof = profiler or {}
    if not cc and not prof.get("cities"):
        raise SystemExit(
            f"V2 PROFILE ERROR: country '{country}' is not built-in (PL/DE) and the "
            "Country Profiler returned no cities"
        )

    cities = geo.resolve_cities(cc, region, prof.get("cities"))
    if max_cities > 0:
        cities = cities[:max_cities]
    niche = (niche or "").strip()
    if not niche or not cities:
        raise SystemExit(
            f"V2 CONFIG ERROR: niche={niche!r} cities={len(cities)} "
            "(campaign needs niche + country + region/cities)"
        )

    kw = keywords.merge_keywords(
        niche, cc,
        profiler_local=prof.get("nicheKeywordsLocal", ""),
        profiler_english=prof.get("nicheKeywordsEnglish", ""),
    )

    lang_code = "pl" if cc == "PL" else "de" if cc == "DE" else str(prof.get("langCode", "en"))
    iso2 = str(prof.get("iso2", ""))
    country_name = (
        "Poland" if cc == "PL" else "Germany" if cc == "DE"
        else str(prof.get("countryName", country))
    )

    engines = ["searxng", "searxng", "ddg", "mojeek"] if searxng_url else ["ddg", "mojeek"]
    q_per_city = max(1, min(4, queries_per_city))

    queries: list[PlannedQuery] = []
    q_idx = 0
    for city in cities:
        for qi in range(q_per_city):
            if len(queries) >= max_queries:
                break
            queries.append(
                PlannedQuery(
                    query=f"{kw[qi % len(kw)]} {city}",
                    engine=engines[q_idx % len(engines)],
                    city=city,
                )
            )
            q_idx += 1

    return Plan(
        queries=queries,
        engines=engines,
        cc=cc,
        country_name=country_name,
        lang_code=lang_code,
        ddg_kl=geo.ddg_kl(cc, iso2, lang_code),
        niche=niche,
        keywords=kw,
        cities=cities,
    )
