"""Client Research I/O — a richer, internal-data-grounded dossier.

Builds on Company Research: in addition to the company profile / signals / talking points,
it reads the CLIENT'S OWN WORDS (their emails + meeting utterances the ERP already holds) to
derive the interaction context, an interaction history timeline, and a predicted MBTI type +
personality read grounded ONLY in how the client communicates. Business metrics / external
history are intentionally out of scope here (that needs web enrichment — a later phase).
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ClientMessage(BaseModel):
    # 'inbound' = the client's own words (the MBTI signal); 'outbound' = our side.
    direction: str
    text: str
    date: str | None = None


class ClientResearchInput(BaseModel):
    company: str
    contact: str | None = None
    country: str | None = None
    region: str | None = None
    industry: str | None = None
    niche: str | None = None
    product_or_service: str | None = None
    offer: str | None = None
    meeting_time: str | None = None
    known_facts: list[str] = Field(default_factory=list)
    # The conversation so far (emails + any transcript lines). The client's inbound
    # messages are the grounding for interaction context + the MBTI read.
    messages: list[ClientMessage] = Field(default_factory=list)
    transcript_excerpts: list[str] = Field(default_factory=list)


class ProfileItem(BaseModel):
    label: str
    value: str


class HistoryItem(BaseModel):
    date: str | None = None
    kind: str  # e.g. 'email', 'reply', 'meeting'
    summary: str


class Personality(BaseModel):
    tone: str = ""          # e.g. 'warm', 'curt', 'formal'
    decisiveness: str = ""  # e.g. 'decisive', 'hesitant'
    formality: str = ""     # e.g. 'formal', 'casual'
    detail: str = ""        # e.g. 'detail-seeking', 'big-picture'


class Deal(BaseModel):
    # Deal economics extracted ONLY from pricing explicitly discussed in a meeting.
    value: float | None = None      # total deal value (unit_price x qty, or a stated total)
    currency: str = "EUR"
    basis: str = ""                 # how it was derived, e.g. '40 units x EUR 155'
    discussed: bool = False         # False when no concrete pricing was in the transcript


class ClientResearchOutput(BaseModel):
    company: str
    profile: list[ProfileItem] = Field(default_factory=list)
    signals: list[str] = Field(default_factory=list)
    talking_points: list[str] = Field(default_factory=list)
    # A short paragraph: where the relationship stands, grounded in the messages.
    interaction_context: str = ""
    history: list[HistoryItem] = Field(default_factory=list)
    # MBTI predicted ONLY from communication style.
    mbti: str = ""            # 4-letter (e.g. 'INTJ') or '' when too little signal
    mbti_confidence: float = 0.0
    mbti_reasoning: str = ""
    personality: Personality = Field(default_factory=Personality)
    deal: Deal = Field(default_factory=Deal)
