from satellite.geo import (
    REGION_CITIES, ZONE_CITIES, all_cities, ddg_kl, norm_city, resolve_builtin,
    resolve_cities,
)


def test_country_aliases_and_prefix_fallback():
    assert resolve_builtin("Polska") == "PL"
    assert resolve_builtin("deutschland") == "DE"
    assert resolve_builtin("POLAND") == "PL"
    assert resolve_builtin("Polonia") == "PL"   # prefix fallback 'pol'
    assert resolve_builtin("Deutsche") == "DE"  # prefix fallback 'deu'
    assert resolve_builtin("France") == ""


def test_norm_city_folds_diacritics():
    assert norm_city("Dolnośląskie") == "dolnoslaskie"
    assert norm_city("Baden-Württemberg") == "badenwurttemberg"


def test_region_resolution_by_voivodeship():
    cities = resolve_cities("PL", "mazowieckie", None)
    assert cities[0] == "Warszawa"


def test_region_alias_keys():
    assert REGION_CITIES["niederschlesien"] == REGION_CITIES["dolnoslaskie"]


def test_anywhere_expands_to_all_regions():
    cities = resolve_cities("PL", "Anywhere", None)
    assert len(cities) == len(set(norm_city(c) for c in all_cities("PL")))
    assert "Warszawa" in cities and "Gdańsk" in cities


def test_zone_resolution():
    assert resolve_cities("DE", "nearborder", None) == ZONE_CITIES["DE"]["nearborder"]


def test_literal_city_passthrough_and_mixed_list():
    # Wadowice is a real city but not a region/Land key, so it passes through literally;
    # pomorskie expands to its city list.
    cities = resolve_cities("PL", "Wadowice; pomorskie", None)
    assert "Wadowice" in cities and "Gdańsk" in cities


def test_dedup_across_entries():
    cities = resolve_cities("PL", "mazowieckie, Warszawa", None)
    assert cities.count("Warszawa") == 1


def test_ddg_kl():
    assert ddg_kl("PL", "", "") == "pl-pl"
    assert ddg_kl("DE", "", "") == "de-de"
    assert ddg_kl("", "BG", "bg") == "bg-bg"
    assert ddg_kl("", "", "") == "wt-wt"
