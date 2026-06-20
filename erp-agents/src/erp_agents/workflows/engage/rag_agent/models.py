from pydantic import BaseModel, ConfigDict, Field

# Closed set for unsureArea — faithful to the n8n RAG AGENT (PG) "Parse Draft" node.
UNSURE_AREAS = [
    "Finance",
    "Operation",
    "Organization",
    "Legality",
    "Reference - Past Projects/Wins",
]


class ThreadMessage(BaseModel):
    """One outreach-messages row (ERP shape, tolerant of variants)."""

    direction: str | None = None  # "INBOUND" / "OUTBOUND"
    from_address: str | None = None
    body: str = ""
    sent_at: str | None = None


class RagAgentInput(BaseModel):
    """A single UNSURE reply that needs a drafted answer (the needsRag backlog item).

    In the ERP-driven model the backend supplies the thread; the agent grounds ONLY on it.
    """

    prospect_id: str
    campaign_id: str | None = None
    company: str | None = None
    country: str | None = None
    lead_email: str | None = None
    thread: list[ThreadMessage] = Field(default_factory=list)


class RagAgentOutput(BaseModel):
    # Accept the LLM's camelCase keys (alias) or snake_case (populate_by_name).
    model_config = ConfigDict(populate_by_name=True)

    subject: str
    unsure_section: str = Field(alias="unsureSection")
    unsure_signal: str = Field(alias="unsureSignal")
    unsure_area: str = Field(alias="unsureArea")
    area_explanation: str = Field(alias="areaExplanation")
    draft_reply: str = Field(alias="draftReply")
    citations: list[str] = Field(default_factory=list)
