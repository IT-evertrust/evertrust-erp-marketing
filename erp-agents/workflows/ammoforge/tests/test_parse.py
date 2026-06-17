"""parse_forge_json — robust extraction + fail-loud (port of the n8n Parse node)."""
from __future__ import annotations

import pytest

from ammoforge.domain.models import parse_forge_json

GOOD = '{"coldEmail": "[COLD]\\nSubject: x\\nBody: hi", "newsBrief": "some brief"}'


def test_parses_plain_json():
    r = parse_forge_json(GOOD)
    assert r.cold_email.startswith("[COLD]")
    assert r.news_brief == "some brief"
    assert r.as_templates() == {"coldEmail": r.cold_email, "newsBrief": "some brief"}


def test_parses_fenced_json():
    r = parse_forge_json("```json\n" + GOOD + "\n```")
    assert r.news_brief == "some brief"


def test_parses_with_surrounding_prose():
    r = parse_forge_json("Sure! Here it is:\n" + GOOD + "\nHope that helps.")
    assert r.cold_email.startswith("[COLD]")


def test_missing_key_fails_loud():
    with pytest.raises(ValueError):
        parse_forge_json('{"coldEmail": "x"}')


def test_empty_value_fails_loud():
    with pytest.raises(ValueError):
        parse_forge_json('{"coldEmail": "  ", "newsBrief": "y"}')


def test_garbage_fails_loud():
    with pytest.raises(ValueError):
        parse_forge_json("not json at all")
