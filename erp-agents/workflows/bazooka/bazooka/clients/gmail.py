"""Gmail sender — port of the two 'Gmail — Send Outreach' nodes (info@ / Hanna routing).

Body treatment matches n8n: newlines -> <br>, signature image appended, no attribution.
Retry 3x with 3s backoff (the n8n node's retryOnFail settings).

Live-only module: requires google-api-python-client + a token created by `python -m
bazooka.auth <account>` (one-time OAuth consent flow per sender account).
"""
from __future__ import annotations

import base64
import time
from email.mime.text import MIMEText
from pathlib import Path

MAX_TRIES = 3
WAIT_BETWEEN_TRIES_S = 3.0
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


def _service(settings, account: str):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    token_file = Path(settings.gmail_token_dir) / f"{account}.json"
    if not token_file.exists():
        # RuntimeError (not SystemExit) so a per-item send failure is caught by the
        # pipeline's `except Exception`, logged FAILED, and the batch continues.
        raise RuntimeError(
            f"No Gmail token for account '{account}'. Run: python -m bazooka.auth {account}"
        )
    creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def html_body(final_body: str, signature_img_url: str) -> str:
    body = (final_body or "").replace("\r\n", "\n").replace("\n", "<br>")
    return (
        f'{body}<br><br><img src="{signature_img_url}" alt="Evertrust GmbH" '
        'style="max-width:600px;display:block;border:0;">'
    )


def send_html(settings, account: str, to: str, subject: str, body_html: str) -> tuple[str, str]:
    """Send and return (message_id, thread_id)."""
    service = _service(settings, account)
    message = MIMEText(body_html, "html", "utf-8")
    message["To"] = to
    message["From"] = settings.sender_addresses[account]
    message["Subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

    last_exc: Exception | None = None
    for attempt in range(1, MAX_TRIES + 1):
        try:
            sent = (
                service.users().messages().send(userId="me", body={"raw": raw}).execute()
            )
            return sent["id"], sent["threadId"]
        except Exception as exc:  # googleapiclient raises various HttpError subclasses
            last_exc = exc
            if attempt < MAX_TRIES:
                time.sleep(WAIT_BETWEEN_TRIES_S)
    raise RuntimeError(f"Gmail send to {to} failed after {MAX_TRIES} tries: {last_exc}")
