import pytest

from satellite.keywords import merge_keywords
from satellite.plan import build_plan


def test_keyword_interleave_local_first():
    kw = merge_keywords("cybersecurity", "PL")
    # local list first entry, then english list first entry
    assert kw[0] == "cyberbezpieczenstwo"
    assert kw[1] == "Cybersecurity"


def test_keyword_fallback_for_unknown_niche():
    kw = merge_keywords("underwater basket weaving", "PL")
    assert kw == ["underwater basket weaving company",
                  "underwater basket weaving services provider"]


def test_plan_query_shape_and_rotation():
    plan = build_plan(
        niche="cybersecurity", country="Poland", region="mazowieckie",
        profiler=None, searxng_url="", queries_per_city=2, max_queries=600,
    )
    # 6 mazowieckie cities x 2 queries
    assert len(plan.queries) == 12
    assert plan.queries[0].query.endswith(" Warszawa")
    assert [q.engine for q in plan.queries[:4]] == ["ddg", "mojeek", "ddg", "mojeek"]


def test_searxng_weighted_rotation():
    plan = build_plan(
        niche="cybersecurity", country="PL", region="Warszawa",
        profiler=None, searxng_url="https://sx.local", queries_per_city=4,
    )
    assert [q.engine for q in plan.queries] == ["searxng", "searxng", "ddg", "mojeek"]


def test_max_queries_cap():
    plan = build_plan(
        niche="cybersecurity", country="PL", region="Anywhere",
        profiler=None, searxng_url="", queries_per_city=4, max_queries=10,
    )
    assert len(plan.queries) == 10


def test_config_error_loud():
    with pytest.raises(SystemExit, match="V2 CONFIG ERROR"):
        build_plan(niche="", country="PL", region="Warszawa",
                   profiler=None, searxng_url="")


def test_profile_error_loud_for_unknown_country():
    with pytest.raises(SystemExit, match="V2 PROFILE ERROR"):
        build_plan(niche="cybersecurity", country="Bulgaria", region="anywhere",
                   profiler=None, searxng_url="")


def test_profiled_country_uses_profiler_cities():
    prof = {"cities": ["Sofia", "Plovdiv"], "iso2": "BG", "langCode": "bg",
            "countryName": "Bulgaria", "nicheKeywordsLocal": "киберсигурност",
            "nicheKeywordsEnglish": "cybersecurity"}
    plan = build_plan(niche="cybersecurity", country="Bulgaria", region="anywhere",
                      profiler=prof, searxng_url="")
    assert plan.cities == ["Sofia", "Plovdiv"]
    assert plan.ddg_kl == "bg-bg"
    assert plan.keywords[0] == "киберсигурност"
