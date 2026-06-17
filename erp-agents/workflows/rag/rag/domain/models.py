from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class UnsureLead:
    """A lead with status='unsure', extracted + email-validated + inbox-routed.
    Port of the 'Extract Unsure Leads' code node output."""
    lead_email: str
    company_name: str
    country: str
    campaign_id: int
    campaign_name: str
    sent_from: str       # full address — info@... or hanna@...
    lead_id: int = 0

    @property
    def account(self) -> str:
        """Which Gmail mailbox token to use: 'hanna' | 'info'."""
        return "hanna" if "hanna" in self.sent_from.lower() else "info"


@dataclass(frozen=True)
class ThreadContext:
    """Built from a Gmail thread — labeled transcript + idempotency key.
    Port of the 'Build Thread Context' code node output."""
    lead_email: str
    company_name: str
    country: str
    campaign_id: int
    thread_id: str
    formatted_thread: str
    dedup_key: str           # leadEmail|threadId|lastMessageId
    client_reply_email: str
    scanned_from: str        # the lead's sent_from (full address)


@dataclass(frozen=True)
class ModelOutput:
    """Parsed LLM JSON. Port of the 'Parse Hermes Reply' code node output."""
    subject: str
    unsure_section: str
    unsure_signal: str
    unsure_area: str
    area_explanation: str
    draft_reply: str
    citations: list = field(default_factory=list)
