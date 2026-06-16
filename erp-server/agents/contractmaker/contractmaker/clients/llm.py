"""The two LLM extractors — signing detection + partner identity. Prompts VERBATIM from
the n8n information-extractor nodes. Offline stubs let the pipeline run without a gateway."""
from __future__ import annotations

import json
import re

SIGNAL_SYSTEM = """You read a post-meeting note between EVERTRUST (a German public-tender bidding/advisory firm) and a PARTNER company. Extract:
- companyName = the partner company common/short name as spoken; empty if not named.
- country = "Poland" for a Polish partner (Sp. z o.o. / .pl), "Germany" for a German partner (GmbH / .de); infer only from explicit cues, else empty.
- niche = the cooperation sector/niche as ONE short word, chosen from: Container, LED, IT, PV, Cleaning, Painting, BESS. Infer from the meeting topic/products/title; empty if unclear.
- contractSigningMentioned = true ONLY if the note clearly indicates BOTH sides have agreed to sign / are signing / will sign the EVERTRUST cooperation contract NOW. If it is just interest, a pitch, "will review", "will consult", or negotiating, it is false.
- signingReason = brief reason/quote.
- meetingOutcome = ONE short sentence (max ~20 words) summarizing what happened or the next step in THIS meeting (e.g. "Pricing discussed, partner will review internally", "Agreed to sign next week").
- cooperationTerm = the agreed cooperation DURATION/term ONLY if explicitly stated (e.g. "3-6 month trial", "12 months", "trial then annual"); empty if not stated.
Never invent. Output only what the text supports."""

DEAL_SYSTEM = """You extract the PARTNER company legal identity from these aggregated EVERTRUST sales-meeting transcripts to prepare a cooperation contract. ABSOLUTE RULE — NO FABRICATION: output a value ONLY if it is literally stated in the text; otherwise an empty string. partnerLegalName = the full registered name including the legal form (Sp. z o.o., GmbH, S.A.) only if that form was literally spoken. partnerStreet, partnerPostalCity = the registered address only if stated. partnerSignatory + partnerSignatoryRole = the person who will sign and their role, only if explicitly named. commissionDetail + setupFee = the agreed figures verbatim if stated. An empty string is the correct, safe answer whenever a fact was not spoken — never guess a plausible company name, address, or person."""


def _client(settings):
    from openai import OpenAI
    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL not set — use --no-llm or configure the gateway.")
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


def _extract(settings, system: str, text: str) -> dict:
    resp = _client(settings).chat.completions.create(
        model=settings.llm_model,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": text}],
    )
    return _brace_slice(resp.choices[0].message.content) or {}


def _brace_slice(text):
    if not isinstance(text, str):
        return None
    t = text.strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        return json.loads(t[a:b + 1])
    except json.JSONDecodeError:
        return None


def signal_extract(settings, text: str) -> dict:
    return _extract(settings, SIGNAL_SYSTEM, text)


def deal_extract(settings, aggregate_text: str) -> dict:
    return _extract(settings, DEAL_SYSTEM, aggregate_text)


_SIGN_RE = re.compile(r"\b(agreed to sign|will sign|sign(ing)? (the|our) contract|let'?s sign|ready to sign)\b", re.I)


def offline_signal(text: str) -> dict:
    """--no-llm stub: crude signing heuristic + niche/country guesses for testing."""
    t = text or ""
    return {
        "companyName": "",
        "country": "Germany" if re.search(r"gmbh|\.de\b", t, re.I) else ("Poland" if re.search(r"sp\. z o\.o\.|\.pl\b", t, re.I) else ""),
        "niche": "",
        "contractSigningMentioned": bool(_SIGN_RE.search(t)),
        "signingReason": "(offline heuristic)",
        "meetingOutcome": "(offline)",
        "cooperationTerm": "",
    }
