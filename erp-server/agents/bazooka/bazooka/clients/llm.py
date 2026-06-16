"""Pre-send LLM personalization via the LiteLLM gateway — prompt kept verbatim with the
n8n workflow zyCTVLpZj3YyR2qV ("Code — Prepare LLM Payload" + "OpenAI — Pre-send Validate" +
"Code — Parse Validation JSON"), including the COLD-AGG bad-news hook rules.

Fail-safe matches n8n: unparseable LLM output => valid=False (prospect logged FAILED, not
sent). offline_fill() is the --no-llm / test path. Placeholders match case/space/underscore-
insensitively, so both {{companyName}} and {{Company Name}} work.
"""
from __future__ import annotations

import json
import re

from ..domain.models import Campaign, News, Prospect, Template, Validation

SYSTEM_PROMPT = (
    "You are an outreach validator. Always respond with raw JSON only — no prose, no code fences."
)
MAX_ATTEMPTS = 2


def _values(prospect: Prospect, campaign: Campaign) -> dict[str, str]:
    return {
        "companyname": prospect.company_name,
        "companytype": prospect.company_type,
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
    return _PLACEHOLDER_RE.sub(lambda m: values.get(_norm_key(m.group(1)), m.group(0)), text)


def build_prompt(
    prospect: Prospect, campaign: Campaign, template: Template, block: str, news: News, email: str
) -> str:
    news_section = ""
    if block == "COLD-AGG" and news.body:
        news_section = (
            "Recent demand-driver / BAD-news intel for this niche (AGGRESSIVE variant only — "
            "use it to open with ONE short, NATURAL sentence in the email language tying the "
            "threat to GERMAN tender demand; if the template already opens with the hook keep "
            "exactly one and do not duplicate; never paste arrow chains; never fabricate):\n"
            + news.body
            + "\n\n"
        )
    return (
        "You are an email finalizer. Your job: take the template below and produce a "
        "ready-to-send email by replacing the {{...}} placeholders with real lead data.\n\n"
        "Lead data:\n"
        f"- Company Name: {prospect.company_name}\n"
        f"- Company Type: {prospect.company_type}\n"
        f"- Email: {email}\n\n"
        "Campaign context (use only if helpful for personalisation):\n"
        f"- Niche: {campaign.niche}\n"
        f"- City: {campaign.city}\n"
        f"- Project: {campaign.project}\n\n"
        + news_section
        + f"Template to fill in ({block} block):\n"
        f"Subject: {template.subject}\n"
        f"Body: {template.body}\n\n"
        "Instructions:\n"
        "1. Replace every {{Company Name}} placeholder with the lead Company Name.\n"
        "2. Replace every {{Company Type}} placeholder with the lead Company Type.\n"
        "3. Replace any {{city}} with the campaign city, {{project}} with the campaign "
        "project (if those placeholders appear).\n"
        "4. You may very lightly personalise the body for tone (1-2 small word changes max). "
        "Do not invent facts. Do not change structure or core meaning.\n"
        "5. Set valid=true unless the lead data is clearly bogus (missing required field, "
        "obviously fake company name, invalid email).\n"
        "6. Do NOT second-guess the template choice or timing — decided upstream.\n"
        "7. If demand-driver news is provided (aggressive COLD-AGG variant only), open with "
        "at most ONE short, NATURAL sentence in the email language tying it to GERMAN tender "
        "demand — never paste raw arrow chains, never duplicate a hook the template already "
        "includes, never invent news. If no news is provided, do not mention any.\n\n"
        "Return JSON only:\n"
        '{ "valid": true or false, "reason": "one-line if invalid else empty", '
        '"finalSubject": "...", "finalBody": "..." }'
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
    settings, prospect: Prospect, campaign: Campaign, template: Template,
    block: str, news: News, email: str,
) -> Validation:
    from openai import OpenAI  # lazy import: not needed for --no-llm runs

    if not settings.litellm_base_url:
        raise SystemExit("LITELLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    client = OpenAI(base_url=settings.litellm_base_url, api_key=settings.litellm_api_key)
    prompt = build_prompt(prospect, campaign, template, block, news, email)
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
    return last


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
