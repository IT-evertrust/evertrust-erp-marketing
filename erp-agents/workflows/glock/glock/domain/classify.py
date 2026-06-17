"""Classification prompt + parsing/derivation — port of 'Code — Build Classify Prompt',
'OpenAI — Classify Reply', and 'Code — Parse Classification'.

The status-derivation logic (verbatim) is pure and lives here; the LLM call is in
clients/llm.py. The status vocabulary is the shared contract with Bazooka:
  Interested | Unsure | Not Interested - Do Not Contact | Not Interested - Snoozed<date>
(Meeting Scheduled is set later, on booking.)
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .models import Classification

TZ = ZoneInfo("Europe/Berlin")
SNOOZE_DAYS = 60

SYSTEM_PROMPT = (
    "You are a reply classifier. Always respond with raw JSON only — no prose, no code fences."
)

USER_TEMPLATE = """You are classifying a reply to a cold outreach email.

Campaign: {niche} in {city} — {project}
Lead: {company_name} ({company_type})
Their reply: {reply_text}

Today is {now_human} (Europe/Berlin).

Classify "classification" as exactly one of: Interested, Unsure, Not Interested.
If and only if classification is "Not Interested", also set "niType":
- "temporary" = a soft no for now (busy, bad timing, no budget/project now, "maybe later", "circle back").
- "permanent" = a hard no / opt-out (stop contacting, remove us, unsubscribe, not relevant, do not contact).
When unsure between temporary and permanent, choose "temporary".
For Interested or Unsure, set "niType" to "".

If the lead proposes or requests a specific meeting date/time, set "proposedDateTime" to that moment as ISO 8601 with timezone offset (assume Europe/Berlin if none given), resolving relative phrases ("tomorrow 3pm", "next Tue morning") against today above. If no specific time is proposed, set "proposedDateTime" to "". Set "proposedRaw" to their exact wording (or "").

Return JSON only:
{{
  "classification": "Interested" or "Unsure" or "Not Interested",
  "niType": "temporary" or "permanent" or "",
  "proposedDateTime": "ISO 8601 or empty",
  "proposedRaw": "their words or empty",
  "confidence": "high" or "low",
  "reasoning": "one sentence"
}}"""


def build_user_prompt(
    *, niche: str, city: str, project: str, company_name: str, company_type: str,
    reply_text: str, now: datetime,
) -> str:
    now_human = now.astimezone(TZ).strftime("%a, %d %b %Y at %H:%M")
    return USER_TEMPLATE.format(
        niche=niche or "", city=city or "", project=project or "",
        company_name=company_name or "", company_type=company_type or "",
        reply_text=reply_text or "", now_human=now_human,
    )


def brace_slice(text: object) -> dict | None:
    if not isinstance(text, str):
        return None
    t = text.strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        return json.loads(t[a : b + 1])
    except json.JSONDecodeError:
        return None


def derive(parsed: dict, today: date, now: datetime) -> Classification:
    """Verbatim port of 'Code — Parse Classification'."""
    c = str(parsed.get("classification", "")).strip()
    normalized = "Interested" if c == "Interested" else ("Not Interested" if c == "Not Interested" else "Unsure")

    ni_type = snooze_until = status = ""
    if normalized == "Not Interested":
        ni_type = "permanent" if str(parsed.get("niType", "")).strip().lower() == "permanent" else "temporary"
        if ni_type == "permanent":
            status = "Not Interested - Do Not Contact"
        else:
            snooze_until = (today + timedelta(days=SNOOZE_DAYS)).isoformat()
            status = f"Not Interested - Snoozed{snooze_until}"  # no delimiter, verbatim
    else:
        status = normalized  # 'Interested' | 'Unsure'

    proposed_start = proposed_end = ""
    if normalized == "Interested":
        pdt = str(parsed.get("proposedDateTime", "")).strip()
        dt = _parse_iso(pdt)
        if dt and dt > now:
            proposed_start = dt.isoformat()
            proposed_end = (dt + timedelta(minutes=30)).isoformat()

    return Classification(
        classification=normalized,
        status=status,
        ni_type=ni_type,
        snooze_until=snooze_until,
        proposed_start=proposed_start,
        proposed_end=proposed_end,
        proposed_raw=str(parsed.get("proposedRaw", "")),
        confidence=str(parsed.get("confidence", "")),
        reasoning=str(parsed.get("reasoning", "")),
    )


def _parse_iso(s: str) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt


_INTERESTED_RE = re.compile(r"\b(interested|yes|let'?s talk|sounds good|schedule|call|meeting|demo)\b", re.I)
_REJECT_RE = re.compile(r"\b(unsubscribe|stop|remove me|not interested|do not contact|no thanks|nicht interessiert)\b", re.I)


def offline_classify(reply_text: str, today: date, now: datetime) -> Classification:
    """--no-llm stand-in: crude keyword heuristic so the pipeline runs without a gateway.
    Testing only — real classification needs the model."""
    t = reply_text or ""
    if _REJECT_RE.search(t):
        parsed = {"classification": "Not Interested", "niType": "permanent"}
    elif _INTERESTED_RE.search(t):
        parsed = {"classification": "Interested"}
    else:
        parsed = {"classification": "Unsure"}
    parsed["reasoning"] = "(offline heuristic — not judged)"
    return derive(parsed, today, now)
