from datetime import date

import pytest

from satellite.serp import Candidate
from satellite.validate import merge_validate, parse_emp_max, parse_founded_year, size_tier

TODAY = date(2026, 6, 12)


def cand(cid, domain, emails=(), cf=False, hits=1):
    c = Candidate(id=cid, domain=domain, url=f"https://{domain}/", name_guess="Guess Co",
                  city="Warszawa", country="Poland", snippet="", hits=hits)
    c.emails = list(emails)
    c.cf_protected = cf
    return c


def comp(cid, **kw):
    base = {"id": cid, "isCompany": True, "nicheMatch": True, "name": "ACME Sp. z o.o.",
            "companyType": "service provider", "city": "", "foundedYear": "",
            "employeeCount": "", "email": ""}
    base.update(kw)
    return base


def validate(companies, cands, **kw):
    by_id = {c.id: c for c in cands}
    return merge_validate(companies, by_id, parsed_chunks=1, failed_chunks=0,
                          today=TODAY, log=lambda *_: None, **kw)


def test_fabricated_id_is_dropped():
    rows, stats = validate(
        [comp("c1"), comp("c999", name="Fabricated GmbH")],
        [cand("c1", "acme.pl", emails=["info@acme.pl"])],
    )
    assert stats.fabricated == 1
    assert len(rows) == 1 and rows[0].company_name == "ACME Sp. z o.o."


def test_model_email_must_be_harvested():
    rows, _ = validate(
        [comp("c1", email="invented@acme.pl")],
        [cand("c1", "acme.pl", emails=["real@acme.pl"])],
    )
    assert rows[0].email == "real@acme.pl"  # invented one rejected, fallback to harvest


def test_status_protected_vs_no_email():
    rows, _ = validate(
        [comp("c1"), comp("c2", name="Other Co")],
        [cand("c1", "a.pl", cf=True), cand("c2", "b.pl", cf=False)],
    )
    by_site = {r.website: r for r in rows}
    assert by_site["https://a.pl/"].status == "PROTECTED"
    assert by_site["https://b.pl/"].status == "NO_EMAIL"


def test_small_company_dropped_unstated_kept():
    rows, stats = validate(
        [comp("c1", employeeCount="12 employees"),
         comp("c2", name="Big Co", employeeCount="")],
        [cand("c1", "small.pl"), cand("c2", "big.pl")],
    )
    assert stats.dropped["tier_c"] == 1
    assert len(rows) == 1 and rows[0].company_name == "Big Co"


def test_tier_from_employees_and_age():
    rows, _ = validate(
        [comp("c1", employeeCount="400"),
         comp("c2", name="Old Co", foundedYear="founded in 2008"),
         comp("c3", name="Mid Co", employeeCount="80-100")],
        [cand("c1", "aaa.pl"), cand("c2", "old.pl"), cand("c3", "mid.pl")],
    )
    tiers = {r.company_name: r.tier for r in rows}
    assert tiers["ACME Sp. z o.o."] == "AAA"
    assert tiers["Old Co"] == "B"      # 2026-2008 = 18y >= 12
    assert tiers["Mid Co"] == "A"


def test_dedup_by_domain_and_name():
    rows, stats = validate(
        [comp("c1"), comp("c2"),                      # same name, different domains
         comp("c3", name="acme  sp. Z O.O.")],        # normalizes to same name
        [cand("c1", "acme.pl"), cand("c2", "acme.com"), cand("c3", "acme.de")],
    )
    assert len(rows) == 1
    assert stats.dropped["dup"] == 2


def test_zero_leads_is_loud():
    with pytest.raises(SystemExit, match="V2 ZERO LEADS"):
        validate([comp("c1", nicheMatch=False)], [cand("c1", "x.pl")])


def test_parsers():
    assert parse_emp_max("50-100 employees") == 100
    assert parse_emp_max(42) == 42
    assert parse_founded_year("est. 1998", 2026) == 1998
    assert parse_founded_year("nonsense", 2026) == 0
    assert size_tier(350) == "AAA" and size_tier(75) == "A" and size_tier(20) == "B" and size_tier(19) == ""


def test_sorted_by_score():
    rows, _ = validate(
        [comp("c1", name="NoMail Co"), comp("c2", name="Mail Co", employeeCount="100")],
        [cand("c1", "x.pl"), cand("c2", "y.pl", emails=["a@y.pl"], hits=3)],
    )
    assert rows[0].company_name == "Mail Co"
