"""Sales Agent I/O + internal domain shapes.

The agent is brain-only: the ERP resolves the persona (PG `personas` table) and passes its
prompt in, runs the coach, and gets the analysis JSON back. Persistence + persona storage
stay in the ERP (mirrors the engage Reply Glock split).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, Field


# ---- workflow input ----
class SalesAgentInput(BaseModel):
    """What the ERP route posts. `persona_prompt` is the resolved system-prompt text from the
    chosen persona; `persona_name` is its display name. `source` routes behaviour: 'erp'
    (return analysis only) vs 'readai'/'manual' (also render a report row)."""

    transcript: str = ""
    persona_name: str = "Alex Hormozi"
    persona_prompt: str = ""
    source: str = "erp"
    # When the caller hands a raw Read.ai webhook body instead of flat text, set this and
    # leave `transcript` empty — the workflow adapts it to timestamped chatInput.
    readai_body: dict | None = None


# ---- internal domain dataclasses (ported from the standalone sales agent) ----
@dataclass(frozen=True)
class ValidationResult:
    """Output of validate_transcript — the central gate. When `valid` is False only `reason`
    is meaningful and the workflow returns status=invalid without scoring."""

    valid: bool
    reason: str = ""
    transcript: str = ""
    agent_input: str = ""  # transcript, optionally low-engagement-context-prefixed
    flags: list[str] = field(default_factory=list)
    active_persona_name: str = ""
    source: str = ""
    stats: dict = field(default_factory=dict)


@dataclass(frozen=True)
class AnalysisRow:
    """The flattened meeting_analyses row built by build_row (for non-erp sources / report)."""

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
