from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ValidationResult:
    """Output of validate_transcript (§6.1). When valid is False, only `reason` is
    meaningful and the pipeline returns a stub error without writing anything."""
    valid: bool
    reason: str = ""
    transcript: str = ""
    agent_input: str = ""                       # transcript, optionally context-prefixed
    flags: list[str] = field(default_factory=list)
    active_persona_name: str = ""
    source: str = ""
    stats: dict = field(default_factory=dict)   # wordCount, turns, distinctSpeakers, primaryShare, otherShare


@dataclass(frozen=True)
class PersonaMatch:
    """Result of resolving a requested persona name against the personas table (§5).
    match_type is one of 'exact' | 'substring' | 'fallback_first'. The fallback case is
    surfaced loudly (FIX: no silent fallback) — never silently mis-score."""
    persona_id: int
    persona_name: str
    requested_persona: str
    match_type: str
    prompt: str


@dataclass(frozen=True)
class AnalysisRow:
    """The clean meeting_analyses row built by render.build_row (§6.10 column set)."""
    client_name: str
    ae_name: str
    meeting_date: str
    summary: str
    strengths: str
    weaknesses: str
    performance_score: int | None
    understanding_client_needs: int | None
    communication: int | None
    technical_explanation: int | None
    aggressiveness: int | None
    client_score: int | None
    client_buying_intent: int | None
    client_interest: int | None
    client_communication: int | None
    persona: str
    source: str

    def as_dict(self) -> dict:
        return {
            "client_name": self.client_name,
            "ae_name": self.ae_name,
            "meeting_date": self.meeting_date,
            "summary": self.summary,
            "strengths": self.strengths,
            "weaknesses": self.weaknesses,
            "performance_score": self.performance_score,
            "understanding_client_needs": self.understanding_client_needs,
            "communication": self.communication,
            "technical_explanation": self.technical_explanation,
            "aggressiveness": self.aggressiveness,
            "client_score": self.client_score,
            "client_buying_intent": self.client_buying_intent,
            "client_interest": self.client_interest,
            "client_communication": self.client_communication,
            "persona": self.persona,
            "source": self.source,
        }
