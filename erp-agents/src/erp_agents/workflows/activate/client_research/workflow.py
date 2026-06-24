"""Activate Client Research — a richer, internal-data-grounded pre-meeting dossier.

Brain-only: the ERP gathers the company context + the client's own messages (emails / meeting
lines) and passes them in; the agent returns profile / signals / talking-points PLUS the
interaction context, a history timeline, and a communication-style MBTI read. Falls back to a
deterministic offline dossier when the LLM gateway is unreachable.
"""
from __future__ import annotations

from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.activate.client_research.models import (
    ClientResearchInput,
    ClientResearchOutput,
    Deal,
    HistoryItem,
    Personality,
    ProfileItem,
)
from erp_agents.workflows.activate.client_research.prompts import (
    RESEARCH_SYSTEM_PROMPT,
    RESEARCH_USER_PROMPT_TEMPLATE,
)


class ClientResearchWorkflow(Workflow):
    name = "activate.client_research"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self._llm = llm
        self._llm_attempted = llm is not None

    @property
    def llm(self) -> LlmClient | None:
        if self._llm is None and not self._llm_attempted:
            self._llm_attempted = True
            try:
                self._llm = LlmClient()
            except Exception:
                self._llm = None
        return self._llm

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            data = ClientResearchInput.model_validate(job.input)
            trace.append(self.trace_step("validate_input", job.input, data.model_dump()))
            dossier, used_llm = self._research(data, trace)
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=dossier.model_dump(),
                metrics={
                    "company": data.company,
                    "messages": len(data.messages),
                    "mbti": dossier.mbti,
                    "used_llm": used_llm,
                    "model": "hermes" if used_llm else "offline",
                },
                trace=trace,
            )
        except Exception as exc:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=[str(exc)],
                trace=trace,
            )

    def _research(
        self, data: ClientResearchInput, trace: list[AgentTraceStep]
    ) -> tuple[ClientResearchOutput, bool]:
        if self.llm is not None:
            try:
                user_prompt = RESEARCH_USER_PROMPT_TEMPLATE.format(
                    company=data.company,
                    contact=data.contact or "Unknown",
                    country=data.country or "Unknown",
                    region=data.region or "Unknown",
                    industry=data.industry or data.niche or "Unknown",
                    product=data.product_or_service or data.offer or "our solution",
                    meeting_time=data.meeting_time or "Upcoming",
                    known_facts=self._format_facts(data.known_facts),
                    messages=self._format_messages(data),
                    transcript=self._format_transcript(data),
                )
                trace.append(self.trace_step("research_prompt", {"system": RESEARCH_SYSTEM_PROMPT}, {"user": user_prompt}))
                raw = self.llm.complete_json(
                    system_prompt=RESEARCH_SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.3
                )
                trace.append(self.trace_step("research_llm", {"model_call": "research"}, raw))
                return self._coerce(data.company, raw), True
            except Exception as exc:
                trace.append(self.trace_step("research_fallback", {"error": str(exc)[:200]}, None))
        return self._offline(data), False

    @staticmethod
    def _format_facts(facts: list[str]) -> str:
        return "\n".join(f"- {f}" for f in facts) if facts else "- (none provided)"

    @staticmethod
    def _format_messages(data: ClientResearchInput) -> str:
        if not data.messages:
            return "(no prior messages)"
        lines = []
        for m in data.messages[:30]:
            who = "CLIENT" if (m.direction or "").lower() == "inbound" else "US"
            when = f"[{m.date}] " if m.date else ""
            lines.append(f"{who} {when}: {m.text.strip()[:600]}")
        return "\n".join(lines)

    @staticmethod
    def _format_transcript(data: ClientResearchInput) -> str:
        if not data.transcript_excerpts:
            return "(none)"
        return "\n".join(f"- {t.strip()[:600]}" for t in data.transcript_excerpts[:20])

    @staticmethod
    def _coerce(company: str, raw: dict) -> ClientResearchOutput:
        profile = [
            ProfileItem(label=str(i["label"]), value=str(i["value"]))
            for i in (raw.get("profile") or [])
            if isinstance(i, dict) and i.get("label") and i.get("value") is not None
        ]
        history = [
            HistoryItem(
                date=(str(h["date"]) if h.get("date") else None),
                kind=str(h.get("kind") or "event"),
                summary=str(h.get("summary") or ""),
            )
            for h in (raw.get("history") or [])
            if isinstance(h, dict) and h.get("summary")
        ]
        p = raw.get("personality") or {}
        personality = Personality(
            tone=str(p.get("tone") or ""),
            decisiveness=str(p.get("decisiveness") or ""),
            formality=str(p.get("formality") or ""),
            detail=str(p.get("detail") or ""),
        )
        mbti = str(raw.get("mbti") or "").upper().strip()
        if len(mbti) != 4:
            mbti = ""
        try:
            conf = float(raw.get("mbti_confidence", 0.0))
        except (TypeError, ValueError):
            conf = 0.0
        d = raw.get("deal") or {}
        deal_value: float | None = None
        if isinstance(d, dict) and d.get("value") is not None:
            try:
                deal_value = float(d["value"])
            except (TypeError, ValueError):
                deal_value = None
        deal = Deal(
            value=deal_value,
            currency=str(d.get("currency") or "EUR") if isinstance(d, dict) else "EUR",
            basis=str(d.get("basis") or "") if isinstance(d, dict) else "",
            discussed=bool(d.get("discussed")) if isinstance(d, dict) else False,
        )
        return ClientResearchOutput(
            company=company,
            profile=profile,
            signals=[str(s) for s in (raw.get("signals") or []) if s],
            talking_points=[str(t) for t in (raw.get("talking_points") or raw.get("talkingPoints") or []) if t],
            interaction_context=str(raw.get("interaction_context") or ""),
            history=history,
            mbti=mbti,
            mbti_confidence=max(0.0, min(1.0, conf)),
            mbti_reasoning=str(raw.get("mbti_reasoning") or ""),
            personality=personality,
            deal=deal,
        )

    @staticmethod
    def _offline(data: ClientResearchInput) -> ClientResearchOutput:
        region = data.region or data.country or "Europe"
        segment = data.industry or data.niche or "Prospect"
        client_lines = [m.text for m in data.messages if (m.direction or "").lower() == "inbound"]
        return ClientResearchOutput(
            company=data.company,
            profile=[
                ProfileItem(label="Type", value=segment),
                ProfileItem(label="Region", value=region),
            ],
            signals=[f[:120] for f in data.known_facts[:2]],
            talking_points=[
                f"Open on fit for {data.product_or_service or data.offer or 'our solution'}",
                "Confirm their timing and decision process",
            ],
            interaction_context=(
                f"{len(client_lines)} message(s) from the client on file."
                if client_lines
                else "No client messages on file yet."
            ),
            history=[],
            mbti="",
            mbti_confidence=0.0,
            mbti_reasoning="LLM unavailable — MBTI not inferred.",
            personality=Personality(),
        )

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
