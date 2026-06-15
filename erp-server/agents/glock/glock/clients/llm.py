"""LLM calls — classify, slot-pick, and the slot-proposal draft. All prompts VERBATIM
from the n8n workflow (DeepSeek via the LiteLLM gateway). Offline stubs let the pipeline
run without a gateway for testing."""
from __future__ import annotations

import json
from datetime import date, datetime

from ..domain import classify as classify_domain
from ..domain.models import Classification, Lead, Reply, Slot

SLOTPICK_SYSTEM = (
    "You are a slot-confirmation parser. Always respond with raw JSON only — "
    "no prose, no code fences."
)

AGENT_SYSTEM = (
    "You write the email yourself, in the voice of Hanna Nguyen at EVERTRUST GmbH. "
    "You are NOT filling in a template — you compose a fresh, human reply every time. "
    "Respond with raw JSON only, no prose, no code fences."
)


def _client(settings):
    from openai import OpenAI

    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


def _chat(settings, system: str, user: str) -> str:
    resp = _client(settings).chat.completions.create(
        model=settings.llm_model, temperature=0.1,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content or ""


def classify(settings, lead: Lead, reply: Reply, today: date, now: datetime) -> Classification:
    user = classify_domain.build_user_prompt(
        niche=lead.niche, city="", project=lead.project,
        company_name=lead.company_name, company_type=lead.company_type,
        reply_text=reply.reply_text, now=now,
    )
    parsed = classify_domain.brace_slice(_chat(settings, classify_domain.SYSTEM_PROMPT, user))
    if not parsed:
        # fail-safe: treat unparseable as Unsure (human follows up), never auto-reject
        parsed = {"classification": "Unsure", "reasoning": "classifier returned unparseable JSON"}
    return classify_domain.derive(parsed, today, now)


def pick_slot(settings, reply_text: str, slot1: dict, slot2: dict) -> int | None:
    user = (
        "You are parsing a reply to a slot-proposal email.\n"
        "The lead was offered:\n"
        f"Slot 1: {slot1.get('human', '(unknown)')} (start {slot1.get('start', '')})\n"
        f"Slot 2: {slot2.get('human', '(unknown)')} (start {slot2.get('start', '')})\n\n"
        f"Their reply: {reply_text or ''}\n\n"
        "Return JSON only:\n"
        '{\n  "chosenSlot": 1 or 2 or null,\n  "reasoning": "one sentence"\n}\n'
        "If they didn't clearly pick one of the two slots, set chosenSlot to null."
    )
    parsed = classify_domain.brace_slice(_chat(settings, SLOTPICK_SYSTEM, user))
    if not parsed:
        return None
    chosen = parsed.get("chosenSlot")
    return chosen if chosen in (1, 2) else None


def draft_proposal(settings, lead: Lead, reply: Reply, slot1: Slot, slot2: Slot) -> str:
    """AI Agent slot-proposal draft. Prompt verbatim; returns body HTML."""
    user = f"""Write Hanna's reply to a lead who just answered our cold outreach with interest. The reply proposes two meeting slots. Make it sound like a real person wrote it — never like a template.
CONTEXT:
- fromEmail: {reply.from_email}
- leadEmail: {lead.email}
- Subject: {reply.subject}
- Company: {lead.company_name}
- Their reply: {reply.reply_text}
- Campaign: {lead.niche} in  — {lead.project}
- Sender identity: {lead.sender}
VOICE — follow strictly:
- Decisive and warm, NEVER apologetic. Never use: "I'm sorry", "Sorry", "Unfortunately", "I'm afraid", "I hope this finds you well", "Please do not hesitate". No emojis.
- Open with genuine appreciation for their interest — register the person, don't just transact.
- Include exactly ONE specific, true detail pulled from their reply or the campaign ({lead.company_name}, {lead.niche}, or {lead.project}). One real detail beats any pleasantry. Do not invent facts.
- Use "I would love to…" for the personal offer to take it further; "we" for company actions. Measured eagerness, never gushing. Treat them as a peer, never deferential.
- Short paragraphs (max 3 sentences), one blank line between, exactly one ask. Close facing forward.
LANGUAGE: Detect the language of their reply. If it is German, write the ENTIRE email in German; otherwise English.
SALUTATION: "Dear {lead.company_name}," (English) or "Sehr geehrte Damen und Herren von {lead.company_name}," (German).
REQUIRED — these must appear exactly, on their own lines (keep the slot text unchanged; translate only the instruction sentence if writing in German):
{slot1.human}
{slot2.human}
SIGN-OFF — match the sender identity above:
- If sender is "hanna": end with  Kind regards,<br>Hanna Nguyen<br>EVERTRUST GmbH   (German: Mit freundlichen Grüßen,<br>Hanna Nguyen<br>EVERTRUST GmbH)
- Otherwise: end with  Kind regards,<br>EVERTRUST GmbH   (German: Mit freundlichen Grüßen,<br>EVERTRUST GmbH)

OUTPUT — raw JSON only, no prose, no code fences:
{{"bodyHtml": "<the full email as HTML, salutation through sign-off, using <br> for every line break>"}}"""
    parsed = classify_domain.brace_slice(_chat(settings, AGENT_SYSTEM, user))
    if parsed and parsed.get("bodyHtml"):
        return str(parsed["bodyHtml"])
    return offline_proposal(lead, slot1, slot2)


def offline_proposal(lead: Lead, slot1: Slot, slot2: Slot) -> str:
    """Deterministic proposal body for --no-llm / fallback."""
    signoff = ("Kind regards,<br>Hanna Nguyen<br>EVERTRUST GmbH"
               if lead.sender == "hanna" else "Kind regards,<br>EVERTRUST GmbH")
    return (
        f"Dear {lead.company_name},<br><br>"
        "Thank you for your interest. I would love to set up a short call. "
        "Would either of these work for you?<br><br>"
        f"{slot1.human}<br>{slot2.human}<br><br>{signoff}"
    )
