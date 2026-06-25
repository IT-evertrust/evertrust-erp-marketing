from pydantic import BaseModel, Field


class RefineTrainingInput(BaseModel):
    """Raw operator feedback to convert into a clean persona rule.

    `note` is whatever the operator typed into the "Train · Feedback" box. The
    workflow rephrases it into ONE concise, declarative instruction that reads well
    as a line in a persona's system prompt.
    """

    note: str = Field(..., description="Raw operator feedback / instruction")
    persona_name: str | None = Field(
        default=None, description="The persona the rule will be added to (for context)"
    )
    campaign_context: str | None = Field(
        default=None, description="Optional campaign context (niche/offer)"
    )


class RefineTrainingOutput(BaseModel):
    rule: str = Field(..., description="A single declarative persona rule")
