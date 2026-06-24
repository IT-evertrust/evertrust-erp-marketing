from datetime import date, timedelta

# Reuse the shared German-vs-English detector from the Reply Glock brain — it is a pure helper,
# so there is no reason to maintain a second copy of the German signal word list.
from erp_agents.workflows.engage.reply_glock.workflow import detect_language
from erp_agents.workflows.nurture.sleeper_grenade.models import SleeperAction

# n8n SLEEPER GRENADE: a re-engaged prospect that goes quiet is snoozed another 60 days out.
SNOOZE_DAYS = 60

# Dual-vocabulary hard opt-out tokens — mirrors the n8n "Do Not Contact" / "Not Interested At All"
# routing, plus the obvious unsubscribe phrasings, evaluated against the prospect's status string.
_OPT_OUT_TOKENS = (
    "do not contact",
    "do-not-contact",
    "do_not_contact",
    "not interested at all",
    "unsubscribe",
    "remove us",
    "opt out",
    "opt-out",
)


def decide_action(
    *, do_not_contact: bool, status: str | None, email: str | None
) -> tuple[SleeperAction, str, float]:
    """The brain's routing decision for a snooze-due prospect.

    Mirrors the n8n IF fork (do-not-contact vs re-engage) plus a guard for prospects the backend
    can't actually action. The backend trusts and executes whatever comes back.
    """
    if not email or "@" not in email:
        return "SKIP", "No usable email address; nothing to send.", 0.9

    status_text = (status or "").lower()
    if do_not_contact or any(token in status_text for token in _OPT_OUT_TOKENS):
        return "SUPPRESS", "Prospect is a hard opt-out / do-not-contact.", 0.95

    return "RE_ENGAGE", "Snooze window elapsed; prospect is still contactable.", 0.8


def pick_language(*signals: str | None) -> str:
    """'de' or 'en' for the re-engagement draft.

    EVERTRUST's prospect base is German, so we default to German when there is no usable text
    signal — only switch to English when the prospect's own prior wording is clearly English.
    """
    text = " ".join(s for s in signals if s).strip()
    if not text:
        return "de"
    return detect_language(text)


def next_snooze_window(today: date | None = None) -> str:
    """The follow-up window the backend can re-apply if a re-engage is declined: today + 60d."""
    base = today or date.today()
    return (base + timedelta(days=SNOOZE_DAYS)).isoformat()


def ui_bucket_for_action(action: SleeperAction) -> dict:
    mapping = {
        "RE_ENGAGE": {"label": "Re-engage", "bucket": "reengage", "priority": "medium"},
        "SUPPRESS": {"label": "Suppress", "bucket": "suppress", "priority": "low"},
        "SKIP": {"label": "Skip", "bucket": "skip", "priority": "low"},
    }
    return mapping[action]
