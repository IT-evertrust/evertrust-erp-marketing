"""Region -> cities is STRUCTURAL only now (no hardcoded country tables): nationwide defers to the
LLM profiler, explicit lists are kept verbatim, a single region/city name passes through."""
from __future__ import annotations

from satellite.domain.geo import cities_for, is_nationwide, is_zone


def test_nationwide_defers_to_profiler():
    # "Anywhere" returns [] here — the pipeline's LLM profiler supplies the country's real cities.
    assert cities_for("Poland", "Anywhere") == []
    assert cities_for("Germany", "nationwide") == []
    assert is_nationwide("Anywhere") and is_nationwide("Wszystkie")
    assert not is_nationwide("Mazowieckie")


def test_aim_zones_detected():
    # AIM REGION_OPTIONS: compass parts + near-border -> zones (profiler expands them, not literal).
    for z in ("North", "South", "East", "West", "Central", "Near border (DE-PL)", "Border-DE"):
        assert is_zone(z), z
    # not zones: nationwide, a real region name, an explicit city
    assert not is_zone("Anywhere")
    assert not is_zone("Mazowieckie")
    assert not is_zone("Warszawa")


def test_explicit_city_list_is_strict():
    assert cities_for("Germany", "Berlin, Munich") == ["Berlin", "Munich"]
    assert cities_for("Poland", "Warszawa") == ["Warszawa"]


def test_single_region_name_passes_through():
    # No hardcoded region->city table: a single region name is one literal geo search term.
    assert cities_for("Poland", "Mazowieckie") == ["Mazowieckie"]
    assert cities_for("Slovakia", "Bratislavský kraj") == ["Bratislavský kraj"]


def test_cyrillic_city_list_is_kept():
    out = cities_for("Bulgaria", "София, Пловдив, Варна")
    assert len(out) == 3 and "София" in out


def test_empty_region_uses_default_regions_as_literals():
    assert cities_for("", "") == []
    assert cities_for("Germany", "") == []
    # default_regions are used verbatim (literal geo terms), not expanded via a table
    assert cities_for("Poland", "", ["Mazowieckie", "Pomorskie"]) == ["Mazowieckie", "Pomorskie"]
