import json

import pytest

from rag.domain.parse import ParseError, parse_reply

VALID = {
    "subject": "Following up",
    "unsureSection": "not sure about pricing",
    "unsureSignal": "pricing concern",
    "unsureArea": "Finance",
    "areaExplanation": "lead questions cost",
    "draftReply": "Dear Acme,\n\nThanks.",
    "citations": ["quote one"],
}


def test_parses_plain_json():
    out = parse_reply(json.dumps(VALID))
    assert out.subject == "Following up"
    assert out.unsure_area == "Finance"
    assert out.citations == ["quote one"]


def test_strips_json_code_fences():
    text = "```json\n" + json.dumps(VALID) + "\n```"
    out = parse_reply(text)
    assert out.unsure_area == "Finance"


def test_strips_bare_fences():
    text = "```\n" + json.dumps(VALID) + "\n```"
    assert parse_reply(text).subject == "Following up"


def test_brace_slice_ignores_surrounding_prose():
    text = "Sure, here is the result:\n" + json.dumps(VALID) + "\nHope that helps!"
    assert parse_reply(text).unsure_area == "Finance"


def test_citations_default_to_empty_list():
    d = dict(VALID)
    del d["citations"]
    assert parse_reply(json.dumps(d)).citations == []


def test_citations_non_list_coerced_to_empty():
    d = dict(VALID, citations="not a list")
    assert parse_reply(json.dumps(d)).citations == []


def test_invalid_area_raises():
    d = dict(VALID, unsureArea="Pricing")
    with pytest.raises(ParseError):
        parse_reply(json.dumps(d))


def test_invalid_area_allowed_when_validation_off():
    d = dict(VALID, unsureArea="Pricing")
    assert parse_reply(json.dumps(d), validate_area=False).unsure_area == "Pricing"


def test_all_valid_areas_accepted():
    for area in ["Finance", "Operation", "Organization", "Legality",
                 "Reference - Past Projects/Wins"]:
        d = dict(VALID, unsureArea=area)
        assert parse_reply(json.dumps(d)).unsure_area == area


def test_unparseable_raises():
    with pytest.raises(ParseError):
        parse_reply("no json here at all")


def test_non_string_raises():
    with pytest.raises(ParseError):
        parse_reply({"already": "dict"})


def test_broken_json_raises():
    with pytest.raises(ParseError):
        parse_reply('{"subject": "x", unsureArea: }')
