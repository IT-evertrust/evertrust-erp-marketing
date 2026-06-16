"""The defensive Sales Coach JSON parser — VERBATIM port of n8n 'Parse Analysis JSON'
(§6.8). hermes can't reliably drive the structured-output parser, so the JSON is parsed
here: already-object passthrough -> fence strip -> outermost-brace slice -> json.loads ->
unwrap {output:{...}} -> required-keys gate. On ANY failure it raises (no silent recovery).

The pipeline catches ParseError, records it to error_log, and skips the write — it does NOT
crash the process (FIX vs blueprint's unsure_analysis suggestion: that's the RAG agent's
table; for sales, error_log + skip is correct)."""
from __future__ import annotations

import json
import re

# §6.8 fence regex: ```(?:json)?\s*([\s\S]*?)```  -> use group 1
_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")

_REQUIRED = ["overall_summary", "sales_technique_analysis", "performance_score", "client_analysis"]


class ParseError(Exception):
    """Raised on any parse failure — caller routes to error_log and skips the write."""


def parse_analysis_json(text):
    """Return the parsed analysis dict. Raises ParseError on any failure."""
    # already parsed -> passthrough
    if text and isinstance(text, (dict, list)):
        return text if isinstance(text, dict) else {"output": text}

    text = str(text or "")
    cleaned = text.strip()

    # strip markdown fence -> group 1
    fence = _FENCE_RE.search(cleaned)
    if fence:
        cleaned = fence.group(1).strip()

    # slice to outermost braces
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ParseError("Agent returned no JSON object")
    cleaned = cleaned[start:end + 1]

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ParseError(f"Agent JSON failed to parse: {e}")

    # unwrap {output:{...}}
    if isinstance(parsed, dict) and isinstance(parsed.get("output"), dict):
        parsed = parsed["output"]

    # required-keys check
    missing = [k for k in _REQUIRED if k not in parsed]
    if missing:
        raise ParseError(f"Agent JSON missing required keys: {missing}")

    return parsed
