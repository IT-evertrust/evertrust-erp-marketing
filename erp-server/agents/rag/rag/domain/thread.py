"""Port of the 'Build Thread Context' n8n code node.

Pure: takes a list of already-fetched Gmail message dicts (Gmail API `format=full` shape:
{id, internalDate, snippet, payload:{headers, body, parts}}) plus the UnsureLead, and
returns a ThreadContext (or None if the thread has no lead message).

Sort ascending by internalDate, take last 20, label [LEAD]/[EVERTRUST] by From containing
the lead email, body-cap 2000 chars, build the formatted transcript, compute dedupKey."""
from __future__ import annotations

import base64
import re

from .models import ThreadContext, UnsureLead

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _header(payload: dict, name: str) -> str:
    for h in payload.get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _decode_b64url(data: str) -> str:
    return base64.urlsafe_b64decode(data).decode("utf-8", "replace")


def _extract_body(payload: dict) -> str:
    """Prefer body.data, else first text/plain part, else recurse into multipart/*."""
    data = payload.get("body", {}).get("data")
    if data:
        return _decode_b64url(data)
    for part in payload.get("parts", []) or []:
        mime = part.get("mimeType", "")
        if mime == "text/plain" and part.get("body", {}).get("data"):
            return _decode_b64url(part["body"]["data"])
    for part in payload.get("parts", []) or []:
        if (part.get("mimeType", "") or "").startswith("multipart/"):
            nested = _extract_body(part)
            if nested:
                return nested
    return ""


def build_thread_context(
    messages: list[dict],
    lead: UnsureLead,
    *,
    thread_id: str = "",
    msgs_cap: int = 20,
    body_cap: int = 2000,
) -> ThreadContext | None:
    """Build the labeled transcript for one lead's thread. Returns None if no lead message
    is present (the n8n `!hasLeadMessage → continue` behavior)."""
    lead_email = lead.lead_email.lower()
    ordered = sorted(messages, key=lambda m: int(m.get("internalDate", 0) or 0))
    ordered = ordered[-msgs_cap:]

    blocks: list[str] = []
    has_lead_message = False
    client_reply_email = ""
    last_message_id = ""
    resolved_thread_id = thread_id

    for msg in ordered:
        payload = msg.get("payload", {})
        from_hdr = _header(payload, "From")
        subject = _header(payload, "Subject")
        date_hdr = _header(payload, "Date")
        last_message_id = msg.get("id", "") or last_message_id
        if not resolved_thread_id:
            resolved_thread_id = msg.get("threadId", "") or ""

        is_lead = lead_email in from_hdr.lower()
        label = "[LEAD]" if is_lead else "[EVERTRUST]"
        if is_lead:
            has_lead_message = True
            m = EMAIL_RE.search(from_hdr)
            if m and not client_reply_email:
                client_reply_email = m.group(0).lower()

        body = (_extract_body(payload) or msg.get("snippet", "") or "").strip()
        if len(body) > body_cap:
            body = body[:body_cap]

        blocks.append(
            f"--- {label} | {date_hdr} ---\n"
            f"From: {from_hdr}\n"
            f"Subject: {subject}\n\n"
            f"{body}"
        )

    if not has_lead_message:
        return None

    dedup_key = f"{lead_email}|{resolved_thread_id}|{last_message_id}"
    return ThreadContext(
        lead_email=lead_email,
        company_name=lead.company_name,
        country=lead.country,
        campaign_id=lead.campaign_id,
        thread_id=resolved_thread_id,
        formatted_thread="\n\n".join(blocks),
        dedup_key=dedup_key,
        client_reply_email=client_reply_email or lead_email,
        scanned_from=lead.sent_from,
    )
