"""Ammo Forge data contracts.

Ammo Forge is the AIM content generator: given a campaign's config (the AIM input
fields), it produces the three outreach email templates (cold / follow-up / final
push) plus a short news brief on demand drivers for the niche. LLM-backed with a
deterministic offline fallback so the pipeline is testable without a live model.
"""

from typing import Literal

from pydantic import BaseModel, Field


class AmmoForgeInput(BaseModel):
    """The AIM input fields = the campaign config.json."""

    campaign_id: str | None = None
    name: str
    niche: str
    region: str
    segment: str | None = None
    source: str | None = None
    country: str = "Germany"
    # Optional admin overrides (tone/language/signature) — kept simple for v1.
    language: Literal["en", "de"] = "en"
    tone: str | None = None
    signature: str | None = None


class EmailTemplate(BaseModel):
    subject: str
    body: str


class CampaignTemplates(BaseModel):
    cold_outreach: EmailTemplate
    follow_up: EmailTemplate
    final_push: EmailTemplate


class NewsBrief(BaseModel):
    title: str
    body: str


class AmmoForgeOutput(BaseModel):
    campaign_id: str | None = None
    name: str
    niche: str
    region: str
    templates: CampaignTemplates
    news_brief: NewsBrief
    # "llm" when the model produced the content, "offline" for the deterministic
    # fallback — lets the UI/backend show whether content is real or scaffolded.
    generated_by: Literal["llm", "offline"] = "offline"
    notes: list[str] = Field(default_factory=list)
