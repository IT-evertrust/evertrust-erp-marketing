from pydantic import BaseModel, Field


class ReadAiSyncInput(BaseModel):
    """How many recent Read.ai meetings to pull and (attempt to) import."""

    limit: int = Field(default=25, ge=1, le=100)


class ReadAiSyncOutput(BaseModel):
    """The mapped import items, ready for the ERP's importReadAiMeetings.

    status: "ok" when the pull ran (items may still be empty), "disabled" when the
    Read.ai API key/base URL is not configured.
    items: camelCase dicts matching the ERP's ReadAiImportItem shape.
    """

    status: str
    reason: str | None = None
    items: list[dict] = Field(default_factory=list)
    count: int = 0
