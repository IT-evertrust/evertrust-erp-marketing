"""Geography dataset (GeoNames-derived) lookup. Skips if the data file isn't built."""
import pytest

from satellite.domain import geodata as g

_HAS_DATA = bool(g._load())
needs_data = pytest.mark.skipif(not _HAS_DATA, reason="satellite/data/geodata.json not built")


def test_unknown_country_is_graceful():
    # No data OR unknown country -> empty/False, never raises (pipeline falls back to the profiler).
    assert g.has_country("Narnia") is False
    assert g.cities_for_country("Narnia") == []
    assert g.regions("Narnia") == []


@needs_data
def test_country_name_and_code_resolve():
    assert g.has_country("Germany") and g.has_country("DE") and g.has_country("Deutschland")
    assert g.has_country("Poland") and g.has_country("Vietnam")


@needs_data
def test_poland_regions_and_top_city():
    regs = g.regions("Poland")
    assert len(regs) >= 14
    assert any("mazov" in r.lower() for r in regs)              # Mazovia present
    assert g.cities_for_country("Poland", limit=1) == ["Warsaw"]  # biggest-first


@needs_data
def test_region_exact_match_not_zone():
    bav = g.cities_for_country("Germany", region="Bavaria", limit=5)
    assert "Munich" in bav
    # a ZONE word must NOT fuzzy-match a real region (was a bug: "North" -> North Rhine-Westphalia)
    assert g.cities_for_country("Germany", region="North") == []


@needs_data
def test_min_pop_filters_down():
    allc = len(g.cities_for_country("Poland"))
    big = len(g.cities_for_country("Poland", min_pop=100000))
    assert big < allc and big > 0


@needs_data
def test_region_batches_shape():
    rb = g.region_batches("Poland", min_pop=20000, per_region_limit=5)
    assert rb and all(len(cities) <= 5 for _, cities in rb)
    names = dict(rb)
    assert any("Warsaw" == c for cs in names.values() for c in cs)
