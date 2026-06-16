"""Port of the 'Parse Hermes Reply' n8n code node.

Tolerant JSON parsing: strip ```json code fences, slice from the first `{` to the last `}`,
json.loads, coerce to the seven output fields, validate unsureArea against the closed set.

Pure. No I/O."""
from __future__ import annotations

import json

from .enums import UNSURE_AREAS
from .models import ModelOutput


class ParseError(ValueError):
    """Raised when the model output cannot be parsed into a ModelOutput."""


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        # drop the opening fence line (```json / ```)
        nl = t.find("\n")
        if nl != -1:
            t = t[nl + 1:]
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip()


def parse_reply(text: object, *, validate_area: bool = True) -> ModelOutput:
    """Parse the raw model content into a ModelOutput.

    Raises ParseError on unparseable JSON or (when validate_area) an out-of-set unsureArea.
    """
    if not isinstance(text, str):
        raise ParseError(f"model content was not a string: {type(text).__name__}")
    t = _strip_fences(text)
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        raise ParseError(f"no JSON object found in model output: {text[:200]!r}")
    try:
        data = json.loads(t[a:b + 1])
    except json.JSONDecodeError as exc:
        raise ParseError(f"invalid JSON from model: {exc}; raw={text[:200]!r}") from exc
    if not isinstance(data, dict):
        raise ParseError(f"model output JSON was not an object: {type(data).__name__}")

    citations = data.get("citations", [])
    if not isinstance(citations, list):
        citations = []

    unsure_area = str(data.get("unsureArea", "")).strip()
    if validate_area and unsure_area not in UNSURE_AREAS:
        raise ParseError(
            f"unsureArea {unsure_area!r} not in closed set {sorted(UNSURE_AREAS)}"
        )

    return ModelOutput(
        subject=str(data.get("subject", "")),
        unsure_section=str(data.get("unsureSection", "")),
        unsure_signal=str(data.get("unsureSignal", "")),
        unsure_area=unsure_area,
        area_explanation=str(data.get("areaExplanation", "")),
        draft_reply=str(data.get("draftReply", "")),
        citations=[str(c) for c in citations],
    )
