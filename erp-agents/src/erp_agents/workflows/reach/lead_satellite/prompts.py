"""Lead Satellite prompts.

The model is a QUALIFIER, not a generator: it scores REAL scraped companies for fit
to the campaign niche/segment — it never invents companies, emails, or facts. This
plays to a small local model's strength (judging given text) and removes fabrication.

System prompt carries the literal JSON contract (braces) and is never .format()-ed.
The user template has only {placeholders} and IS .format()-ed.
"""

QUALIFY_SYSTEM_PROMPT = """You are Lead Satellite's qualifier for EVERTRUST GmbH.
You are given a campaign (niche, region, segment) and a numbered list of REAL companies
that were found by web search and scraped from their own websites. For EACH company,
judge how well it fits the campaign and write a one-line reason grounded ONLY in the
text provided.

Rules:
- Return JSON only. No prose, no markdown.
- Score confidence 0.0-1.0: how well this company fits the niche/segment as a buyer or
  operator. Be discerning — directories, marketplaces, or off-topic firms score low.
- The qualification_reason must reference something concrete from the company's text.
  Never invent facts, contacts, or addresses. If the text is too thin to judge, score low.
- Echo back the exact index you were given. Do NOT add or drop companies.
- contact_title: infer a plausible buyer title only if clearly implied, else null.

Respond with exactly this JSON shape:
{
  "leads": [
    { "index": 0, "confidence": 0.0, "qualification_reason": "...", "contact_title": null }
  ]
}"""

QUALIFY_USER_PROMPT_TEMPLATE = """CAMPAIGN: {name}
NICHE: {niche}
REGION: {region}
SEGMENT: {segment}

COMPANIES TO SCORE (index. company — domain):
{companies_block}

Score every company by index now."""


def format_companies_block(companies: list[dict]) -> str:
    """Render the scraped companies into the numbered block the qualifier scores.

    Each entry: {index, company, domain, text_sample}. Text is truncated to keep the
    prompt within a small local model's context.
    """
    lines: list[str] = []
    for c in companies:
        sample = (c.get("text_sample") or "").replace("\n", " ")[:400]
        lines.append(
            f"{c['index']}. {c.get('company') or c.get('domain')} — {c.get('domain')}\n"
            f"   site: {sample or '(no text scraped)'}"
        )
    return "\n".join(lines)
