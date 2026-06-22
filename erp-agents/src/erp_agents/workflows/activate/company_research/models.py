"""Company Research I/O.

Brain-only: the ERP gathers the company context it already knows (from campaign / prospect /
company rows) and passes it in; the agent turns it into a pre-meeting dossier. The ERP fills the
UI-facing id / status / meetingTime around the returned profile / signals / talking points.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class CompanyResearchInput(BaseModel):
    company: str
    contact: str | None = None
    country: str | None = None
    region: str | None = None
    industry: str | None = None
    niche: str | None = None
    product_or_service: str | None = None
    offer: str | None = None
    meeting_time: str | None = None
    # Free-form facts the ERP already holds (campaign notes, prospect signals, prior thread, …).
    known_facts: list[str] = Field(default_factory=list)


class ProfileItem(BaseModel):
    label: str
    value: str


class CompanyResearchOutput(BaseModel):
    company: str
    profile: list[ProfileItem] = Field(default_factory=list)
    signals: list[str] = Field(default_factory=list)
    talking_points: list[str] = Field(default_factory=list)
