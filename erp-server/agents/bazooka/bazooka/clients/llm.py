"""Pre-send LLM personalization via the LiteLLM gateway (mac-mini).

Takes the campaign template + an ERP prospect and produces a ready-to-send subject/body
by filling {{...}} placeholders. Prompt kept close to the n8n original (tuned on the live
campaigns). Fail-safe: unparseable LLM output => valid=False (prospect is skipped, logged).

offline_fill() is the --no-llm / test path: deterministic placeholder replacement so the
whole pipeline runs with no gateway (used by the route->reach test).

Placeholders are matched case/space/underscore-insensitively, so both {{companyName}} and
{{Company Name}} work.
"""
from __future__ import annotations

import json
import re

from ..domain.models import Campaign, Prospect, Template, Validation

SYSTEM_PROMPT = (
    "You are an outreach validator. Always respond with raw JSON only — no prose, no code fences."
)
MAX_ATTEMPTS = 2


def _values(prospect: Prospect, campaign: Campaign) -> dict[str, str]:
    return {
        "companyname": prospect.company_name,
        "companytype": "",  # the ERP prospect has no company type
        "city": prospect.city or campaign.city,
        "country": prospect.country or campaign.country,
        "project": campaign.project,
        "niche": campaign.niche,
        "website": prospect.website,
    }


def _norm_key(s: str) -> str:
    return re.sub(r"[\s_]+", "", s).strip().lower()


_PLACEHOLDER_RE = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


def _fill(text: str, values: dict[str, str]) -> str:
    def sub(match: re.Match) -> str:
        return values.get(_norm_key(match.group(1)), match.group(0))

    return _PLACEHOLDER_RE.sub(sub, text)


def build_prompt(prospect: Prospect, campaign: Campaign, template: Template, email: str) -> str:
    return (
        "You are an email finalizer. Take the template below and produce a ready-to-send "
        "email by replacing the {{...}} placeholders with real prospect data.\n\n"
        "Prospect data:\n"
        f"- Company Name: {prospect.company_name}\n"
        f"- Website: {prospect.website}\n"
        f"- City: {prospect.city}\n"
        f"- Country: {prospect.country}\n"
        f"- Email: {email}\n"
        f"- Current Status: {prospect.status} (followup #{prospect.followup_count})\n\n"
        "Campaign context (use only if helpful for personalisation):\n"
        f"- Niche: {campaign.niche}\n"
        f"- City: {campaign.city}\n"
        f"- Project: {campaign.project}\n\n"
        "Template to fill in:\n"
        f"Subject: {template.subject}\n"
        f"Body: {template.body}\n\n"
        "Instructions:\n"
        "1. Replace every {{companyName}}/{{Company Name}} with the prospect Company Name.\n"
        "2. Replace {{city}} with the city, {{project}} with the campaign project, etc.\n"
        "3. You may very lightly personalise the body for tone (1-2 small word changes max). "
        "Do not invent facts. Do not change the structure or core meaning.\n"
        '4. Set "valid": true unless the prospect data is clearly bogus (missing company, '
        "obviously fake name, invalid email).\n"
        "5. Do NOT second-guess the template choice or timing — decided upstream.\n\n"
        "Return JSON only:\n"
        "{\n"
        '  "valid": true or false,\n'
        '  "reason": "one-line explanation if invalid, empty string if valid",\n'
        '  "finalSubject": "the final subject with all placeholders replaced",\n'
        '  "finalBody": "the final body with all placeholders replaced"\n'
        "}"
    )


def _parse_response(text: str, fallback: Template) -> Validation:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError) as exc:
        return Validation(False, f"invalid JSON from LLM: {exc}", fallback.subject, fallback.body)
    return Validation(
        valid=bool(data.get("valid")),
        reason=str(data.get("reason") or ""),
        final_subject=str(data.get("finalSubject") or fallback.subject),
        final_body=str(data.get("finalBody") or fallback.body),
    )


def personalize(
    settings, prospect: Prospect, campaign: Campaign, template: Template, email: str
) -> Validation:
    from openai import OpenAI  # lazy import: not needed for --no-llm runs

    if not settings.litellm_base_url:
        raise SystemExit("LITELLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    client = OpenAI(base_url=settings.litellm_base_url, api_key=settings.litellm_api_key)
    prompt = build_prompt(prospect, campaign, template, email)
    last: Validation | None = None
    for _ in range(MAX_ATTEMPTS):
        response = client.chat.completions.create(
            model=settings.llm_model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        )
        last = _parse_response(response.choices[0].message.content or "", template)
        if last.valid or not last.reason.startswith("invalid JSON"):
            return last
    return last  # parse kept failing — fail-safe invalid


def offline_fill(
    prospect: Prospect, campaign: Campaign, template: Template, email: str
) -> Validation:
    """Deterministic placeholder replacement — no LLM, for tests / isolated runs."""
    values = _values(prospect, campaign)
    return Validation(
        valid=True,
        reason="",
        final_subject=_fill(template.subject, values),
        final_body=_fill(template.body, values),
    )
