import re
from datetime import date, timedelta

from erp_agents.workflows.engage.reply_glock.models import RecommendedAction, ReplyGlockStatus

# n8n REPLY GLOCK (PG): a temporary "not interested" snoozes the prospect 60 days out.
SNOOZE_DAYS = 60

_QUOTE_PATTERNS = [
    r"\nOn .+ wrote:",
    r"\nFrom: .+\nSent: .+",
    r"\n-{2,}\s*Original Message\s*-{2,}",
    r"\n_{5,}",
]

_SIGNATURE_PATTERNS = [
    r"\n--\s*\n",
    r"\n(Best regards|Kind regards|Regards|Cheers|Sincerely|"
    r"Mit freundlichen Grüßen|Viele Grüße)[,.]?\s*\n",
]


def clean_email_body(body: str) -> tuple[str, dict]:
    """Strip trailing quoted text and obvious signature blocks from a reply body."""
    cleaned = (body or "").strip()
    removed_quoted_text = False
    removed_signature = False

    for pattern in _QUOTE_PATTERNS:
        match = re.search(pattern, cleaned, flags=re.IGNORECASE | re.DOTALL)
        if match and len(cleaned[: match.start()].strip()) >= 20:
            cleaned = cleaned[: match.start()].strip()
            removed_quoted_text = True
            break

    for pattern in _SIGNATURE_PATTERNS:
        match = re.search(pattern, cleaned, flags=re.IGNORECASE)
        if match and len(cleaned[: match.start()].strip()) >= 20:
            cleaned = cleaned[: match.start()].strip()
            removed_signature = True
            break

    return cleaned, {
        "removed_quoted_text": removed_quoted_text,
        "removed_signature": removed_signature,
    }


def recommended_action_for_status(status: ReplyGlockStatus) -> RecommendedAction:
    mapping: dict[str, RecommendedAction] = {
        "INTERESTED": "SEND_REPLY",
        "UNSURE": "SAVE_DRAFT",
        "TEMPORARY": "SNOOZE_FOLLOW_UP",
        "UNINTERESTED": "MARK_CLOSED",
    }
    return mapping.get(status, "MANUAL_REVIEW")


def ui_bucket_for_status(status: ReplyGlockStatus) -> dict:
    mapping = {
        "INTERESTED": {"label": "Interested", "bucket": "interested", "priority": "high"},
        "UNSURE": {"label": "Unsure", "bucket": "unsure", "priority": "medium"},
        "TEMPORARY": {"label": "Temporary", "bucket": "temporary", "priority": "medium"},
        "UNINTERESTED": {"label": "Uninterested", "bucket": "uninterested", "priority": "low"},
    }
    return mapping[status]


def default_snooze_date(today: date | None = None) -> str:
    """The default follow-up window for a TEMPORARY reply: today + SNOOZE_DAYS (ISO date)."""
    base = today or date.today()
    return (base + timedelta(days=SNOOZE_DAYS)).isoformat()
