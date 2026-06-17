"""Minimal Gmail send for Sleeper's re-engage email (text). Live-only — needs the Hanna
Gmail OAuth token (same client as the other agents). Tests inject a fake."""
from __future__ import annotations

import base64
from email.mime.text import MIMEText
from pathlib import Path

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


def _service(settings, account: str):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    token_file = Path(settings.gmail_token_dir) / f"{account}.json"
    if not token_file.exists():
        raise SystemExit(f"No Gmail token for '{account}'. Run the consent flow first.")
    creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def send_text(settings, account: str, to: str, subject: str, body: str) -> tuple[str, str]:
    service = _service(settings, account)
    msg = MIMEText(body, "plain", "utf-8")
    msg["To"] = to
    msg["From"] = settings.sender_addresses[account]
    msg["Subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return sent.get("id", ""), sent.get("threadId", "")
