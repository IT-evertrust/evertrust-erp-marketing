# Importing dependencies: 
from typing import Any
from pydantic import BaseModel, Field

# Enums:
ReplyGlockStatus = Literal[
    "INTERESTED",
    "UNSURE",
    "TEMPORARY",
    "UNINTERESTED"
],

RecommendedAction = Literal[
    "SEND_REPLY",
    "SAVE_DRAFT",
    "SNOOZE_FOLLOW_UP",
    "MARK_CLOSED",
    "MANNUAL_REVIEW",
]

DraftPurpose = Literal[
    "MOVE_TO_METTING",
    "ANSWER_QUESTION",
    "CLOSE_POLITELY",
    "SCHEDULE_FUTURE_FOLLOW_UP",
]


class ThreadMessage(BaseModel):
    direction: Literal["inbound", "outbound"]
    from_name: str | None = None
    from_emai: str | None = None
    to_email: str | None = None
    subject: str
    body: str
    timestamp: str | None = None
    
class CampaignContext(BaseModel):
    campaign_id: str
    campaign_name: str
    product_or_service: str
    offer: str
    sender_name: str
    sender_company: str
    sender_signature: str | None = None

class ReplyGlockInput(BaseModel):
    reply_id: str
    campaign_id: str
    lead_id: str | None = None
    
    sender_name: str | None = None
    sender_email: str | None = None
    company: str | None = None
    
    subject: str
    body: str
    received_at: str | None = None
    
    previous_thread: list[ThreadMessage] = Field(default_factory=list)
    campaign_context: CampaignContext | None = None
    
class NormalizedReply(BaseModel):
    clean_body: str
    detected_language: str | None = None
    removed_quote_text: bool = False
    removed_signature: bool = False

class ExtractedSignals(BaseModel):
    sks_for_pricing: bool = False
    asks_for_quote: bool = False
    asks_for_meeting: bool = False
    asks_question: bool = False
    says_not_interested: bool = False
    asks_to_be_removed: bool = False
    timing_issue: bool = False
    follow_up_date_or_window: str | None = None
    requested_quantity: str | None = None
    requested_documents: list[str] = Field(default_factory=list)
    
class ReplyClassification(BaseModel):
    status: ReplyGlockStatus
    confidence: float = Field(ge=0, le=1)
    reasoning: str
    extracted_signals: ExtractedSignals

class ReplyDraft(BaseModel):
    subject: str
    body: str
    purpose: DraftPurpose
    
class ReplyGlockOutput(BaseModel):
    reply_id: str
    campaign_id: str
    lead_id: str | None = None

    status: ReplyGlockStatus
    confidence: float = Field(ge=0, le=1)
    reasoning: str

    sender_name: str | None = None
    sender_email: str
    company: str | None = None

    original_subject: str
    clean_body: str

    extracted_signals: ExtractedSignals
    recommended_action: RecommendedAction

    draft: ReplyDraft

    follow_up_needed: bool = False
    follow_up_date_or_window: str | None = None

    ui: dict
    
    