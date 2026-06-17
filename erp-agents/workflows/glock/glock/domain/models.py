from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class Reply:
    """A discovered unread reply, hydrated from Gmail."""
    message_id: str
    thread_id: str
    from_email: str
    subject: str
    reply_text: str
    account: str  # which inbox it arrived in: 'info' | 'hanna' (also the reply identity)


@dataclass(frozen=True)
class Lead:
    """The prospect this reply belongs to, resolved from the ERP (GET /prospects?email=)."""
    prospect_id: str
    campaign_id: str
    company_name: str
    company_type: str
    email: str
    status: str
    sender: str          # 'info' | 'hanna' — which identity replies to this lead
    niche: str
    project: str
    campaign_name: str


@dataclass(frozen=True)
class Classification:
    """Parsed + derived output of the classify LLM call."""
    classification: str          # 'Interested' | 'Unsure' | 'Not Interested'
    status: str                  # derived status (shared vocabulary)
    ni_type: str = ""            # 'temporary' | 'permanent' | ''
    snooze_until: str = ""       # YYYY-MM-DD when temporary
    proposed_start: str = ""     # ISO 8601 if the lead named a time
    proposed_end: str = ""
    proposed_raw: str = ""
    confidence: str = ""
    reasoning: str = ""


@dataclass(frozen=True)
class Slot:
    start: datetime
    end: datetime
    human: str

    def as_dict(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "human": self.human}


@dataclass
class RunCounts:
    interested: int = 0
    unsure: int = 0
    not_interested: int = 0
    booked: int = 0
    skipped: int = 0
    errors: int = 0

    def as_dict(self) -> dict:
        return {
            "interested": self.interested, "unsure": self.unsure,
            "not_interested": self.not_interested, "booked": self.booked,
            "skipped": self.skipped, "errors": self.errors,
        }
