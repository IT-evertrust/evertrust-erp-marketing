"""LLM re-engage draft for Sleeper — prompt verbatim with n8n workflow cZDGIoudM6yg17kV
('AI — Draft Re-engage'). Returns {subject, body}. offline_reengage is the --no-llm/test path."""
from __future__ import annotations

from ..domain.models import Prospect, ReengageDraft, parse_draft

SYSTEM = (
    "You are EverTrust's outreach assistant. Write a short, warm, professional German "
    're-engagement email to a prospect who previously said "not interested" but whose snooze '
    "window has now elapsed. Reference their company, keep it under 120 words, no pushy language, "
    'one clear soft call to action. Return ONLY a JSON object with exactly two string keys: '
    '"subject" and "body". No markdown, no code fences.'
)


def draft_reengage(settings, p: Prospect) -> ReengageDraft:
    from openai import OpenAI

    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    user = (f"Prospect first name: {p.first_name}\nCompany: {p.company_name}\n"
            f"Previous status: {p.status}\nWrite the re-engagement email now.")
    resp = client.chat.completions.create(
        model=settings.llm_model, temperature=0.4, max_tokens=600,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
    )
    return parse_draft(resp.choices[0].message.content or "")


def offline_reengage(p: Prospect) -> ReengageDraft:
    name = p.first_name or "there"
    company = p.company_name or "your team"
    return ReengageDraft(
        subject=f"Kurze Rückfrage — {company}",
        body=(f"Hallo {name},\n\nvor einiger Zeit hatten wir Kontakt zu {company}. "
              "Inzwischen hat sich bei deutschen öffentlichen Ausschreibungen einiges getan. "
              "Hätten Sie Interesse an einem kurzen Austausch?\n\nBeste Grüße\nEVERTRUST GmbH"),
    )
