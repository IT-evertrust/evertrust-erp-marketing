"""Tests for the C-tier firmographic gate (age + headcount)."""
from satellite.domain.firmographics import extract_firmographics, firmographic_verdict

CY = 2026  # pin current year so age is deterministic


def test_founded_year_german_english_variants():
    assert extract_firmographics("Wir wurden gegründet 1998 in Berlin.", current_year=CY)["foundedYear"] == 1998
    assert extract_firmographics("Familienbetrieb seit 1975.", current_year=CY)["foundedYear"] == 1975
    assert extract_firmographics("Founded in 2001, we...", current_year=CY)["foundedYear"] == 2001
    assert extract_firmographics("Established 1987 · est. 1990", current_year=CY)["foundedYear"] == 1987  # earliest


def test_copyright_year_is_not_a_founding_year():
    # No founding keyword before the year -> not picked up (avoids © 2024 / address false positives).
    assert extract_firmographics("© 2024 Acme GmbH. Musterstr. 2024.", current_year=CY)["foundedYear"] is None


def test_employee_count_variants_take_the_max():
    assert extract_firmographics("rund 200 Mitarbeiter", current_year=CY)["employees"] == 200
    assert extract_firmographics("Mitarbeiter: 150", current_year=CY)["employees"] == 150
    assert extract_firmographics("a team of 30 experts", current_year=CY)["employees"] == 30
    assert extract_firmographics("über 1.200 Beschäftigte weltweit", current_year=CY)["employees"] == 1200
    assert extract_firmographics("50 Angestellte, 1200 Mitarbeiter", current_year=CY)["employees"] == 1200


def test_age_is_current_year_minus_founded():
    assert extract_firmographics("gegründet 2010", current_year=CY)["age"] == 16


def test_verdict_reject_when_too_young():
    fg = extract_firmographics("gegründet 2022, 80 Mitarbeiter", current_year=CY)  # age 4 < 7
    assert fg["age"] == 4
    assert firmographic_verdict(fg) == "reject"        # too young wins even with many staff


def test_verdict_reject_when_too_small():
    fg = extract_firmographics("gegründet 1990, 5 Mitarbeiter", current_year=CY)
    assert firmographic_verdict(fg) == "reject"        # <10 staff


def test_verdict_promote_when_old_enough_or_sizeable():
    assert firmographic_verdict(extract_firmographics("gegründet 1998", current_year=CY)) == "promote"
    assert firmographic_verdict(extract_firmographics("250 Mitarbeiter", current_year=CY)) == "promote"


def test_verdict_keep_when_nothing_stated():
    assert firmographic_verdict(extract_firmographics("Willkommen auf unserer Seite.", current_year=CY)) == "keep"
