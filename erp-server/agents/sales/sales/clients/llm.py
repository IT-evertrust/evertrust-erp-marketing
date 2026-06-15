"""The single Sales Coach LLM pass + an offline stub. Mirrors contractmaker's llm.py.
The OpenAI-compatible client points at the LiteLLM gateway (LLM_BASE_URL), model "hermes",
temperature 0.2, max_tokens 8000, timeout 180s, max_retries 2 (§9). offline_coach() returns
a VALID strict-schema JSON string so the parser + render path can be exercised with no
gateway."""
from __future__ import annotations

import json


def _client(settings):
    from openai import OpenAI
    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL not set — use --no-llm or configure the gateway.")
    return OpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        timeout=settings.llm_timeout,
        max_retries=settings.llm_max_retries,
    )


def sales_coach(settings, system: str, user: str) -> str:
    """Run the single Sales Coach pass. Returns the raw model string (the parser handles
    fences/braces). system = persona prompt + rubric + strict format; user = agentInput."""
    resp = _client(settings).chat.completions.create(
        model=settings.llm_model,
        temperature=settings.llm_temperature,
        max_tokens=settings.llm_max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or ""


def offline_coach(transcript: str) -> str:
    """--no-llm deterministic stub: a VALID strict-schema JSON string covering all four
    technique dims, the 5 performance sub-scores, the 4 client sub-scores, and
    strengths/weaknesses — so the parser + render path runs offline."""
    def dim(score, ts, rec):
        return {
            "score": score,
            "quotes": [{"text": "(offline stub quote)", "timestamp": ts}],
            "improvement_recommendation": rec,
        }

    obj = {
        "overall_summary": "(offline stub) Sales call analyzed without the LLM.",
        "client_company": "Unknown",
        "ae_name": "",
        "client_contact": "",
        "sales_technique_analysis": {
            "rapport_building": dim(6, "00:30", "Open with a warmer personal check-in."),
            "discovery_quality": dim(5, "03:15", "Ask more open-ended diagnostic questions."),
            "pain_discovery": dim(5, "07:22", "Quantify the cost of inaction before pitching."),
            "value_communication": dim(6, "12:45", "Tie the offer to the client's stated problems."),
        },
        "strengths": [
            {
                "moment": "Clear next steps",
                "timestamp": "05:42",
                "why_effective": "Reduced ambiguity for the client.",
                "methodology": {"source": "Hormozi", "pattern": "Risk Reversal"},
            }
        ],
        "weaknesses": [
            {
                "area": "Discovery",
                "timestamp": "12:08",
                "observation": "Pitched before diagnosing.",
                "evidence_quote": "(offline stub quote)",
                "suggestion": "Diagnose before prescribing.",
                "methodology": {"source": "Hormozi", "pattern": "Name the Objection"},
            }
        ],
        "performance_score": {
            "overall": {"score": 60, "rationale": "(offline stub)"},
            "understanding_client_needs": {"score": 55, "rationale": "(offline stub)"},
            "communication": {"score": 70, "rationale": "(offline stub)"},
            "technical_explanation": {"score": 65, "rationale": "(offline stub)"},
            "aggressiveness": {"score": 40, "rationale": "(offline stub)"},
        },
        "client_analysis": {
            "overall": {"score": 55, "rationale": "(offline stub)"},
            "buying_intent": {"score": 50, "rationale": "(offline stub)"},
            "interest": {"score": 60, "rationale": "(offline stub)"},
            "communication": {"score": 65, "rationale": "(offline stub)"},
        },
    }
    return json.dumps(obj)
