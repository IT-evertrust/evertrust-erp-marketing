import json

import pytest

from sales.domain.parse import ParseError, parse_analysis_json

VALID = {
    "overall_summary": "x",
    "sales_technique_analysis": {},
    "performance_score": {},
    "client_analysis": {},
}


def test_parse_plain_json():
    out = parse_analysis_json(json.dumps(VALID))
    assert out["overall_summary"] == "x"


def test_parse_already_object_passthrough():
    out = parse_analysis_json(VALID)
    assert out is VALID


def test_parse_fence_strip():
    text = "```json\n" + json.dumps(VALID) + "\n```"
    out = parse_analysis_json(text)
    assert out["overall_summary"] == "x"


def test_parse_brace_slice_with_prose():
    text = "Here is the analysis:\n" + json.dumps(VALID) + "\nThanks!"
    out = parse_analysis_json(text)
    assert out["performance_score"] == {}


def test_parse_unwrap_output():
    text = json.dumps({"output": VALID})
    out = parse_analysis_json(text)
    assert out["overall_summary"] == "x"  # unwrapped


def test_parse_missing_keys_raises():
    with pytest.raises(ParseError):
        parse_analysis_json(json.dumps({"overall_summary": "x"}))


def test_parse_no_object_raises():
    with pytest.raises(ParseError):
        parse_analysis_json("no json here at all")


def test_parse_bad_json_raises():
    with pytest.raises(ParseError):
        parse_analysis_json("{not valid json,,,}")
