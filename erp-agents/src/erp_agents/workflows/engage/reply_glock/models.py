from typing import Literal

from pydantic import BaseModel, Field

# The four primary Engage buckets. These are a clean flattening of the n8n REPLY GLOCK (PG)
# classifier (Interested / Unsure / Not Interested + niType temporary|permanent):
#   INTERESTED   <- Interested
#   UNSURE       <- Unsure
#   TEMPORARY    <- Not Interested + niType "temporary"  (soft no / later)
#   UNINTERESTED <- Not Interested + niType "permanent"  (hard no / do-not-contact)
ReplyGlockStatus = Literal["INTERESTED", "UNINTERESTED", "UNSURE", "TEMPORARY"]

RecommendedAction = Literal[
    "SEND_REPLY", "SAVE_DRAFT", "SNOOZE_FOLLOW_UP", "MARK_CLOSED", "MANUAL_REVIEW"
]

DraftPurpose = Literal[
    "MOVE_TO_MEETING", "ANSWER_QUESTION", "CLOSE_POLITELY", "SCHEDULE_FUTURE_FOLLOW_UP"
]


class ThreadMessage(BaseModel):
    direction: Literal["inbound", "outbound"]
    from_name: str | None = None
    from_email: str | None = None
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
    sender_email: str
    company: str | None = None

    subject: str
    body: str
    received_at: str | None = None

    previous_thread: list[ThreadMessage] = Field(default_factory=list)
    campaign_context: CampaignContext | None = None

    # Engage drafting controls (optional):
    #   persona  — a salesperson's voice/pattern the draft should imitate (the same
    #              persona prompt Activate uses for call coaching).
    #   guidance — accumulated "teach the AI" notes the draft must ALWAYS apply.
    #   instruction — a one-off operator instruction for an interactive re-draft
    #              ("make it shorter", "offer a Tuesday slot"); skips re-classification.
    #   current_draft — the existing draft to revise when `instruction` is set.
    persona: str | None = None
    guidance: list[str] = Field(default_factory=list)
    instruction: str | None = None
    current_draft: dict[str, str] | None = None
    # On an interactive re-draft we already know the bucket — skip re-classifying.
    prior_status: ReplyGlockStatus | None = None

    # The slots we already offered this lead, so the agent can match an acceptance.
    proposed_slots: list[dict] = Field(default_factory=list)  # [{"start","end"}]


class NormalizedReply(BaseModel):
    clean_body: str
    detected_language: str | None = None
    removed_quoted_text: bool = False
    removed_signature: bool = False


class ExtractedSignals(BaseModel):
    asks_for_pricing: bool = False
    asks_for_quote: bool = False
    asks_for_meeting: bool = False
    asks_question: bool = False
    says_not_interested: bool = False
    asks_to_be_removed: bool = False
    timing_issue: bool = False
    follow_up_date_or_window: str | None = None
    requested_quantity: str | None = None
    requested_documents: list[str] = Field(default_factory=list)


class SchedulingVerdict(BaseModel):
    # The client accepted one of the slots we offered (0-based into proposed_slots), or None.
    accepted_index: int | None = None
    # A specific time the client asked for that we did NOT offer (ISO-8601), or None.
    counter_time: str | None = None


def parse_scheduling(raw: dict, proposed_slots: list[dict]) -> SchedulingVerdict:
    """Map the model's raw scheduling JSON onto a validated verdict.

    Pure + total: an out-of-range or non-int accepted_index clamps to None (no
    acceptance), and counter_time is kept only when it's a non-empty string.
    """
    idx = raw.get("accepted_index")
    if isinstance(idx, int) and 0 <= idx < len(proposed_slots):
        return SchedulingVerdict(accepted_index=idx, counter_time=None)
    ct = raw.get("counter_time")
    return SchedulingVerdict(accepted_index=None, counter_time=ct if isinstance(ct, str) and ct else None)


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

    scheduling: SchedulingVerdict = Field(default_factory=SchedulingVerdict)

    ui: dict
