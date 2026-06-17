"""Read.ai payload adapter — port of 'Adapt Transcript' (§6.2). Webhook data lives at
body.* (preserve that). Produces the chatInput the validator + Sales Coach read: timestamped
[mm:ss] Speaker: words, optionally prefixed with a Read.ai context block.

This is a thin wrapper over domain.transcript.adapt_readai so the body-unwrapping convention
matches the other agents."""
from __future__ import annotations

from .domain.transcript import adapt_readai


def adapt(body: dict) -> dict:
    """body is the full webhook payload; the transcript lives at body['body'] (the n8n
    $json.body convention). Returns {chatInput, active_persona_name, source}."""
    body = body or {}
    inner = body.get("body") if isinstance(body.get("body"), dict) else body
    out = adapt_readai(inner)
    return {
        "chatInput": out.get("chatInput", ""),
        "_readai_error": out.get("_readai_error"),
        "active_persona_name": str(inner.get("persona") or "Alex Hormozi"),
        "source": str(inner.get("source") or "readai"),
    }
