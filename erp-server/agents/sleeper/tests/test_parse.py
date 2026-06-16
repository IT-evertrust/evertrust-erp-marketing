from __future__ import annotations

import pytest

from sleeper.domain.models import parse_draft, to_prospect


def test_parse_draft_ok():
    d = parse_draft('{"subject": "Hallo", "body": "kurzer Text"}')
    assert d.subject == "Hallo" and d.body == "kurzer Text"


def test_parse_draft_fenced():
    d = parse_draft('```json\n{"subject":"S","body":"B"}\n```')
    assert d.subject == "S" and d.body == "B"


def test_parse_draft_missing_fails():
    with pytest.raises(ValueError):
        parse_draft('{"subject": "only subject"}')


def test_parse_draft_garbage_fails():
    with pytest.raises(ValueError):
        parse_draft("not json")


def test_to_prospect_maps_camel_and_snake():
    p = to_prospect({"id": "x", "email": "a@b.de", "companyName": "Acme",
                     "doNotContact": True, "followupCount": 2})
    assert p.id == "x" and p.company_name == "Acme" and p.do_not_contact is True and p.followup_count == 2
