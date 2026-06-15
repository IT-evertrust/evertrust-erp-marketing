"""Gmail client — poll/hydrate replies, send replies, stage drafts, mark read.

Wider than Bazooka's send-only client: Reply Glock reads the inbox. Per-account tokens
(info, hanna). Live-only — needs google-api-python-client + tokens from `bazooka.auth`-
style consent (reuse the same OAuth client; scopes here also need gmail.modify + readonly).
"""
from __future__ import annotations

import base64
import re
from email.mime.text import MIMEText
from pathlib import Path

from ..domain.models import Reply

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]


def _service(settings, account: str):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    token_file = Path(settings.gmail_token_dir) / f"{account}.json"
    if not token_file.exists():
        raise SystemExit(f"No Gmail token for '{account}'. Run the consent flow first.")
    creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _header(payload: dict, name: str) -> str:
    for h in payload.get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _body_text(payload: dict) -> str:
    """Walk MIME parts, prefer text/plain, fall back to stripped HTML. Verbatim intent."""
    plain, html = [], []

    def walk(p: dict) -> None:
        mime = p.get("mimeType", "")
        data = p.get("body", {}).get("data")
        if mime == "text/plain" and data:
            plain.append(base64.urlsafe_b64decode(data).decode("utf-8", "replace"))
        elif mime == "text/html" and data:
            html.append(base64.urlsafe_b64decode(data).decode("utf-8", "replace"))
        for child in p.get("parts", []) or []:
            walk(child)

    walk(payload)
    if plain:
        return "".join(plain).strip()
    return re.sub(r"<[^>]+>", " ", "".join(html)).strip()


def fetch_replies(settings, account: str, query: str) -> list[Reply]:
    """List unread replies matching the query, hydrate each, collapse to newest-per-thread."""
    service = _service(settings, account)
    listed = service.users().messages().list(userId="me", q=query).execute()
    by_thread: dict[str, dict] = {}
    for ref in listed.get("messages", []):
        msg = service.users().messages().get(userId="me", id=ref["id"], format="full").execute()
        tid = msg.get("threadId", msg["id"])
        ts = int(msg.get("internalDate", 0))
        if tid not in by_thread or ts > int(by_thread[tid].get("internalDate", 0)):
            by_thread[tid] = msg

    out: list[Reply] = []
    for msg in by_thread.values():
        payload = msg.get("payload", {})
        raw_from = _header(payload, "From")
        m = re.search(r"<([^>]+)>", raw_from)
        from_email = (m.group(1) if m else raw_from).strip()
        out.append(Reply(
            message_id=msg["id"], thread_id=msg.get("threadId", msg["id"]),
            from_email=from_email, subject=_header(payload, "Subject"),
            reply_text=_body_text(payload), account=account,
        ))
    return out


def send_reply(settings, account: str, to: str, thread_id: str, subject: str, body_html: str) -> str:
    """Send a reply within the existing thread. Returns sent message id."""
    service = _service(settings, account)
    body = body_html + (
        f'<br><br><img src="{settings.SIGNATURE_IMG}" alt="Evertrust GmbH" '
        'style="max-width:600px;display:block;border:0;">'
        if hasattr(settings, "SIGNATURE_IMG") else ""
    )
    msg = MIMEText(body, "html", "utf-8")
    msg["To"] = to
    msg["From"] = settings.sender_addresses[account]
    msg["Subject"] = subject if subject.lower().startswith("re:") else f"Re: {subject}"
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = service.users().messages().send(
        userId="me", body={"raw": raw, "threadId": thread_id}
    ).execute()
    return sent["id"]


def create_draft(settings, account: str, to: str, thread_id: str, subject: str, body_html: str) -> str:
    """Stage a draft (the slot proposal — soft human gate, matching n8n). Returns draft id."""
    service = _service(settings, account)
    msg = MIMEText(body_html, "html", "utf-8")
    msg["To"] = to
    msg["From"] = settings.sender_addresses[account]
    msg["Subject"] = subject if subject.lower().startswith("re:") else f"Re: {subject}"
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    draft = service.users().drafts().create(
        userId="me", body={"message": {"raw": raw, "threadId": thread_id}}
    ).execute()
    return draft["id"]


def mark_read(settings, account: str, message_id: str) -> None:
    service = _service(settings, account)
    service.users().messages().modify(
        userId="me", id=message_id, body={"removeLabelIds": ["UNREAD"]}
    ).execute()
