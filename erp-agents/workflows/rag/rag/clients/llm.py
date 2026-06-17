"""LLM call — model `hermes` via the LiteLLM gateway (OpenAI-compatible). Port of the
n8n 'DeepSeek (LiteLLM Gateway)' node: temperature 0.2, JSON output. Prompts are built
verbatim in domain/prompts.py; parsing lives in domain/parse.py.

`offline_analyze` is a deterministic stub for --no-llm: a valid ModelOutput-shaped dict
(MODE B brief-stall reply, unsureArea 'Operation', citations [])."""
from __future__ import annotations

import json


def _client(settings):
    from openai import OpenAI

    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


def analyze(settings, system: str, user: str) -> str:
    """Call hermes with JSON output, temperature 0.2. Returns the raw content string
    (the caller passes it through domain.parse.parse_reply)."""
    resp = _client(settings).chat.completions.create(
        model=settings.llm_model,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or ""


def offline_analyze(lead, thread) -> str:
    """Deterministic offline stand-in (--no-llm). Returns a JSON string matching the
    model's output contract — MODE B brief-stall English reply. Testing only."""
    company = getattr(lead, "company_name", "") or ""
    reply = (
        f"Dear {company},\n\n"
        "Thank you for getting back to us. We have carefully gone through your point and "
        "are currently checking with our operations team to provide you with a complete "
        "answer as soon as possible.\n\n"
        "We will follow up with you very shortly.\n\n"
        "Kind regards,\nHanna Nguyen\nEVERTRUST GmbH"
    )
    return json.dumps({
        "subject": f"Following up on your question{(' — ' + company) if company else ''}",
        "unsureSection": "(offline stub — no model judgement)",
        "unsureSignal": "general hesitation",
        "unsureArea": "Operation",
        "areaExplanation": "offline stub default category, not model-judged",
        "draftReply": reply,
        "citations": [],
    })
