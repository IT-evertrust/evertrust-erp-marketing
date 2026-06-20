import base64
from email.message import EmailMessage
from typing import Any

from googleapiclient.discovery import build

from erp_agents.clients.google_auth import build_google_credentials
from erp_agents.settings import settings

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.readonly",
]


# How agents interact with Gmail (drafts, sends, thread reads). Side-effect client only.
class GmailClient:
    def __init__(self) -> None:
        credentials = build_google_credentials(GMAIL_SCOPES)
        self.service = build("gmail", "v1", credentials=credentials)
        self.user_id = settings.gmail_user_id

    def build_raw_message(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
    ) -> str:
        message = EmailMessage()
        message["To"] = to
        message["Subject"] = subject
        if cc:
            message["Cc"] = cc
        if bcc:
            message["Bcc"] = bcc
        message.set_content(body)
        return base64.urlsafe_b64encode(message.as_bytes()).decode()

    def create_draft(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
    ) -> dict[str, Any]:
        raw = self.build_raw_message(to=to, subject=subject, body=body, cc=cc, bcc=bcc)
        return (
            self.service.users()
            .drafts()
            .create(userId=self.user_id, body={"message": {"raw": raw}})
            .execute()
        )

    def send_email(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
    ) -> dict[str, Any]:
        raw = self.build_raw_message(to=to, subject=subject, body=body, cc=cc, bcc=bcc)
        return (
            self.service.users()
            .messages()
            .send(userId=self.user_id, body={"raw": raw})
            .execute()
        )

    def send_draft(self, draft_id: str) -> dict[str, Any]:
        return (
            self.service.users()
            .drafts()
            .send(userId=self.user_id, body={"id": draft_id})
            .execute()
        )

    def get_thread(self, thread_id: str) -> dict[str, Any]:
        return (
            self.service.users()
            .threads()
            .get(userId=self.user_id, id=thread_id, format="full")
            .execute()
        )
