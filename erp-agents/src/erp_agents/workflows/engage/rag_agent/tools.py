from typing import Any

from erp_agents.workflows.engage.rag_agent.models import UNSURE_AREAS, ThreadMessage

THREAD_BODY_CAP = 2000
THREAD_MAX_MESSAGES = 20


def format_thread(thread: list[ThreadMessage], lead_email: str | None) -> str:
    """Render the conversation as a labeled transcript (faithful to the n8n fmtThread).

    Oldest-first, last 20 messages, each body capped at 2000 chars, labeled [LEAD] vs
    [EVERTRUST]. Empty thread -> a stable placeholder so the prompt is never blank.
    """
    if not thread:
        return "[no prior messages on file]"

    ordered = sorted(thread, key=lambda m: m.sent_at or "")
    recent = ordered[-THREAD_MAX_MESSAGES:]
    lead = (lead_email or "").lower()

    lines: list[str] = []
    for msg in recent:
        sender = (msg.from_address or "").lower()
        is_lead = (msg.direction or "").upper() == "INBOUND" or (bool(lead) and lead in sender)
        label = "[LEAD]" if is_lead else "[EVERTRUST]"
        body = (msg.body or "").strip()[:THREAD_BODY_CAP]
        lines.append(f"{label} {body}")
    return "\n\n".join(lines)


def normalize_draft(raw: dict[str, Any], *, validate_area: bool = True) -> dict[str, Any]:
    """Coerce/validate the LLM's 7-field draft JSON (ports the n8n Parse Draft node).

    - citations must be a list of strings (non-list -> []).
    - draftReply must be non-empty.
    - unsureArea must be in the closed set (only enforced when validate_area, i.e. real LLM).
    """
    citations = raw.get("citations")
    if not isinstance(citations, list):
        citations = []
    raw["citations"] = [str(c) for c in citations]

    draft_reply = str(raw.get("draftReply") or raw.get("draft_reply") or "").strip()
    if not draft_reply:
        raise ValueError("RAG draft is empty (draftReply missing)")

    area = raw.get("unsureArea") or raw.get("unsure_area")
    if validate_area and area not in UNSURE_AREAS:
        raise ValueError(f"unsureArea '{area}' not in {UNSURE_AREAS}")

    return raw
