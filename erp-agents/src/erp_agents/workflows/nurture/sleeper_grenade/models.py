from typing import Literal

from pydantic import BaseModel, Field

# The three actions the Sleeper Grenade brain can recommend for a snooze-due prospect.
# The backend executes whichever one comes back (it owns the side effects, exactly like the
# n8n SLEEPER GRENADE (PG) subtrees):
#   RE_ENGAGE -> snooze window elapsed and the prospect is still contactable. The brain returns
#                a re-engagement draft; the backend gates it via WhatsApp, sends via Gmail, logs
#                an OUTBOUND outreach message, and PATCHes the prospect to RE_ENGAGED.
#   SUPPRESS  -> hard opt-out / do-not-contact. The backend POSTs a suppression (the org-wide
#                send gate) and PATCHes the prospect to DO_NOT_CONTACT. No email, row is kept.
#   SKIP      -> nothing to do (no usable email, not enough to act on). Backend no-ops.
SleeperAction = Literal["RE_ENGAGE", "SUPPRESS", "SKIP"]


class ThreadMessage(BaseModel):
    """A prior message in the prospect's history. Optional context for the draft so the
    re-engagement doesn't repeat an earlier touch verbatim."""

    direction: Literal["inbound", "outbound"]
    from_name: str | None = None
    from_email: str | None = None
    subject: str | None = None
    body: str
    timestamp: str | None = None


class CampaignContext(BaseModel):
    """Same shape as the Reply Glock context so the sender voice/offer is described identically
    across the Engage and Nurture brains."""

    campaign_id: str
    campaign_name: str
    product_or_service: str
    offer: str
    sender_name: str
    sender_company: str
    sender_signature: str | None = None


class SleeperGrenadeInput(BaseModel):
    """One snooze-due prospect, as the backend would hand it over from
    GET /prospects?snoozeDue=true."""

    prospect_id: str
    email: str

    first_name: str | None = None
    company_name: str | None = None

    # Server-side flag (the n8n "Is Do-Not-Contact?" IF branch). When true the brain recommends
    # SUPPRESS without calling the LLM.
    do_not_contact: bool = False

    # Prior status string and the original "not interested" wording, if the backend has it.
    # Used both for the opt-out keyword check and for language detection.
    status: str | None = None
    snooze_reason: str | None = None
    snoozed_until: str | None = None
    last_contacted_at: str | None = None
    followup_count: int = 0

    previous_thread: list[ThreadMessage] = Field(default_factory=list)
    campaign_context: CampaignContext | None = None


class ReEngageDraft(BaseModel):
    subject: str
    body: str


class SleeperGrenadeOutput(BaseModel):
    prospect_id: str
    email: str
    first_name: str | None = None
    company_name: str | None = None

    action: SleeperAction
    confidence: float = Field(ge=0, le=1)
    reasoning: str
    language: str  # "de" | "en" — the language the draft was written in

    # Present only for RE_ENGAGE.
    draft: ReEngageDraft | None = None
    # Present only for SUPPRESS.
    suppression_reason: str | None = None
    # The next snooze window the backend can apply if the manager declines the re-engage.
    follow_up_date_or_window: str | None = None

    ui: dict
