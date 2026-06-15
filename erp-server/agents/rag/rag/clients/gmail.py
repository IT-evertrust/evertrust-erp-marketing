"""Gmail client — search a lead's thread, hydrate it, and stage a DRAFT (never send).

Two accounts: info@ and Hanna. The n8n Hanna search/get-thread nodes were DISABLED; we
fix that here — both mailboxes are fully supported. Live-only: the google libs are
imported inside the functions, and a missing token raises SystemExit.

HARD INVARIANT: this module only ever creates drafts. There is no send path."""
from __future__ import annotations

import base64
from email.mime.text import MIMEText
from pathlib import Path

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
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


def search_threads(settings, account: str, from_email: str) -> list[str]:
    """Find thread ids for messages `from:{from_email}` (newest first). n8n used limit 1,
    readStatus both — we return the ids so the caller can pick the first."""
    service = _service(settings, account)
    listed = service.users().threads().list(
        userId="me", q=f"from:{from_email}", maxResults=5
    ).execute()
    return [t["id"] for t in listed.get("threads", [])]


def get_thread(settings, account: str, thread_id: str) -> list[dict]:
    """Return the thread's messages as Gmail API `format=full` dicts (for thread.py)."""
    service = _service(settings, account)
    thread = service.users().threads().get(
        userId="me", id=thread_id, format="full"
    ).execute()
    return thread.get("messages", [])


def create_draft(settings, account: str, to: str, subject: str, body_html: str) -> str:
    """Stage a Gmail DRAFT (never send). Returns the draft id."""
    service = _service(settings, account)
    msg = MIMEText(body_html, "html", "utf-8")
    msg["To"] = to
    msg["From"] = settings.sender_addresses[account]
    msg["Subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    draft = service.users().drafts().create(
        userId="me", body={"message": {"raw": raw}}
    ).execute()
    return draft["id"]
