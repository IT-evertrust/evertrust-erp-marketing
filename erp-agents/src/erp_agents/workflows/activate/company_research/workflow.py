"""Activate Company Research — builds a pre-meeting dossier for an upcoming meeting.

Brain-only: the ERP supplies the company context it already holds (segment, region, campaign
niche, prospect signals); the agent returns a profile / signals / talking-points dossier. The
ERP caches it against the meeting and shapes it for the UI. Falls back to a deterministic
offline dossier when the LLM gateway is unreachable so the feature still works in dev.
"""
from __future__ import annotations

from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.activate.company_research.models import (
    CompanyResearchInput,
    CompanyResearchOutput,
    ProfileItem,
)
from erp_agents.workflows.activate.company_research.prompts import (
    RESEARCH_SYSTEM_PROMPT,
    RESEARCH_USER_PROMPT_TEMPLATE,
)


class CompanyResearchWorkflow(Workflow):
    """Turn the ERP's known company context into a concise pre-meeting dossier."""

    name = "activate.company_research"

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
            data = CompanyResearchInput.model_validate(job.input)
            trace.append(self.trace_step("validate_input", job.input, data.model_dump()))

            dossier, used_llm = self._research(data, trace)
            output = dossier.model_dump()

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output,
                metrics={
                    "company": data.company,
                    "profile_items": len(dossier.profile),
                    "signals": len(dossier.signals),
                    "talking_points": len(dossier.talking_points),
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
        self, data: CompanyResearchInput, trace: list[AgentTraceStep]
    ) -> tuple[CompanyResearchOutput, bool]:
        if self.llm is not None:
            try:
                user_prompt = RESEARCH_USER_PROMPT_TEMPLATE.format(
                    company=data.company,
                    contact=data.contact or "Unknown",
                    country=data.country or "Unknown",
                    region=data.region or "Unknown",
                    industry=data.industry or data.niche or "Unknown",
                    product=data.product_or_service or data.offer or "balcony solar kits",
                    meeting_time=data.meeting_time or "Upcoming",
                    known_facts=self._format_facts(data.known_facts),
                )
                trace.append(self.trace_step("research_prompt", {"system": RESEARCH_SYSTEM_PROMPT}, {"user": user_prompt}))
                raw = self.llm.complete_json(
                    system_prompt=RESEARCH_SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.4
                )
                trace.append(self.trace_step("research_llm", {"model_call": "research"}, raw))
                return self._coerce(data.company, raw), True
            except Exception as exc:
                trace.append(self.trace_step("research_fallback", {"error": str(exc)[:200]}, None))
        dossier = self._offline(data)
        trace.append(self.trace_step("research_offline", None, {"used": "offline"}))
        return dossier, False

    @staticmethod
    def _format_facts(facts: list[str]) -> str:
        return "\n".join(f"- {f}" for f in facts) if facts else "- (none provided)"

    @staticmethod
    def _coerce(company: str, raw: dict) -> CompanyResearchOutput:
        profile = []
        for item in raw.get("profile") or []:
            if isinstance(item, dict) and item.get("label") and item.get("value") is not None:
                profile.append(ProfileItem(label=str(item["label"]), value=str(item["value"])))
        signals = [str(s) for s in (raw.get("signals") or []) if s]
        talking = [str(t) for t in (raw.get("talking_points") or raw.get("talkingPoints") or []) if t]
        return CompanyResearchOutput(
            company=company, profile=profile, signals=signals, talking_points=talking
        )

    @staticmethod
    def _offline(data: CompanyResearchInput) -> CompanyResearchOutput:
        region = data.region or data.country or "Germany"
        segment = data.industry or data.niche or "Housing / property management"
        profile = [
            ProfileItem(label="Type", value=segment),
            ProfileItem(label="Region", value=region),
            ProfileItem(
                label="Relevance",
                value="Likely fit for tenant / balcony solar at portfolio scale",
            ),
        ]
        if data.known_facts:
            profile.append(ProfileItem(label="Known", value=data.known_facts[0][:80]))
        signals = [
            "German decarbonisation pressure on residential portfolios",
            "Plug-and-play balcony solar lowers retrofit barriers for existing buildings",
        ]
        signals += [f[:120] for f in data.known_facts[:2]]
        product = data.product_or_service or data.offer or "balcony solar kits"
        talking_points = [
            f"Open with portfolio-wide cost reduction via {product}",
            "Position tiered pricing from 100 units as the entry point",
            "Stress plug-and-play = no electrician cost for existing balconies",
            "Use delivery certainty as the close lever",
        ]
        return CompanyResearchOutput(
            company=data.company, profile=profile, signals=signals, talking_points=talking_points
        )

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
