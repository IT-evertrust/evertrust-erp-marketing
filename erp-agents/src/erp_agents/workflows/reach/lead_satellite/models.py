"""Lead Satellite data contracts.

Lead Satellite is triggered with a campaign's config (the AIM fields). It plans a
search strategy and returns qualified lead candidates tied to that campaign. LLM /
search backed, with a deterministic offline fallback so leads are produced (and the
pipeline is testable) even with no model or search key configured.
"""

from typing import Literal

from pydantic import BaseModel, Field


class LeadSatelliteInput(BaseModel):
    """The campaign config that activates Lead Satellite (= the AIM fields)."""

    campaign_id: str
    name: str | None = None
    niche: str
    region: str
    segment: str | None = None
    source: str | None = None
    country: str = "Germany"
    max_leads: int = Field(default=12, ge=1, le=100)


class LeadCandidate(BaseModel):
    company: str
    website: str | None = None
    contact_name: str | None = None
    contact_title: str | None = None
    email: str | None = None
    email_verified: bool = False  # passed MX/syntax verification
    phone: str | None = None
    location: str | None = None
    source: str | None = None
    contact_page: str | None = None  # where the contact data was scraped from
    qualification_reason: str
    confidence: float = Field(ge=0, le=1)


class LeadSatelliteOutput(BaseModel):
    campaign_id: str
    search_strategy: list[str] = Field(default_factory=list)
    leads: list[LeadCandidate] = Field(default_factory=list)
    generated_by: Literal["llm", "offline"] = "offline"
    notes: list[str] = Field(default_factory=list)
