"""Ammo Forge workflow — generates the AIM campaign's templates + news brief.

Flow: validate config -> research demand drivers (LLM or offline) -> forge the
three-step sequence + news brief (LLM or offline) -> compose output. Any LLM error
(gateway down, bad JSON) falls back to the deterministic offline builders, so AIM
always returns usable content and the rest of Reach stays testable.
"""

from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.reach.ammo_forge.models import (
    AmmoForgeInput,
    AmmoForgeOutput,
    CampaignTemplates,
    NewsBrief,
)
from erp_agents.workflows.reach.ammo_forge.prompts import (
    FORGE_SYSTEM_PROMPT,
    FORGE_USER_PROMPT_TEMPLATE,
    RESEARCH_SYSTEM_PROMPT,
    RESEARCH_USER_PROMPT_TEMPLATE,
)
from erp_agents.workflows.reach.ammo_forge.tools import (
    offline_news_brief,
    offline_research,
    offline_templates,
    resolve_signature,
)


class AmmoForgeWorkflow(Workflow):
    name = "reach.ammo_forge"

    def __init__(self, llm: LlmClient | None = None) -> None:
        # Constructed lazily so the workflow can fall back to offline output even
        # when no LLM gateway is configured.
        self._llm = llm
        self._llm_attempted = False

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
        notes: list[str] = []
        try:
            data = AmmoForgeInput.model_validate(job.input)
            trace.append(self._step("validate_input", job.input, data.model_dump()))

            research, used_llm_research = self._research(data, trace, notes)
            templates, news, used_llm_forge = self._forge(data, research, trace, notes)

            generated_by = "llm" if (used_llm_research or used_llm_forge) else "offline"
            output = AmmoForgeOutput(
                campaign_id=data.campaign_id,
                name=data.name,
                niche=data.niche,
                region=data.region,
                templates=templates,
                news_brief=news,
                generated_by=generated_by,
                notes=notes,
            )
            trace.append(self._step("compose_output", None, output.model_dump()))

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics={"generated_by": generated_by, "news_brief_chars": len(news.body)},
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

    # ---- steps ----
    def _research(
        self, data: AmmoForgeInput, trace: list[AgentTraceStep], notes: list[str]
    ) -> tuple[str, bool]:
        if self.llm is not None:
            user = RESEARCH_USER_PROMPT_TEMPLATE.format(
                niche=data.niche,
                region=data.region,
                country=data.country,
                segment=data.segment or "(none)",
            )
            try:
                raw = self.llm.complete_json(
                    system_prompt=RESEARCH_SYSTEM_PROMPT
                    + '\nRespond as JSON: {"brief": "..."}',
                    user_prompt=user,
                    temperature=0.3,
                )
                brief = str(raw.get("brief") or "").strip()
                if brief:
                    trace.append(self._step("research_llm", {"call": "research"}, raw))
                    return brief, True
            except Exception as exc:  # gateway down / bad JSON
                notes.append(f"research fell back to offline: {exc}")
        brief = offline_research(data)
        trace.append(self._step("research_offline", None, {"brief": brief}))
        return brief, False

    def _forge(
        self,
        data: AmmoForgeInput,
        research: str,
        trace: list[AgentTraceStep],
        notes: list[str],
    ) -> tuple[CampaignTemplates, NewsBrief, bool]:
        if self.llm is not None:
            user = FORGE_USER_PROMPT_TEMPLATE.format(
                name=data.name,
                niche=data.niche,
                region=data.region,
                country=data.country,
                segment=data.segment or "(none)",
                language=data.language,
                tone=data.tone or "professional and direct",
                signature=resolve_signature(data),
                research=research,
            )
            try:
                raw = self.llm.complete_json(
                    system_prompt=FORGE_SYSTEM_PROMPT, user_prompt=user, temperature=0.4
                )
                templates = CampaignTemplates.model_validate(
                    {
                        "cold_outreach": raw["cold_outreach"],
                        "follow_up": raw["follow_up"],
                        "final_push": raw["final_push"],
                    }
                )
                news = NewsBrief.model_validate(
                    raw.get("news_brief")
                    or offline_news_brief(data, research).model_dump()
                )
                trace.append(self._step("forge_llm", {"call": "forge"}, raw))
                return templates, news, True
            except Exception as exc:
                notes.append(f"forge fell back to offline: {exc}")
        templates = offline_templates(data)
        news = offline_news_brief(data, research)
        trace.append(
            self._step(
                "forge_offline", None, {"templates": templates.model_dump()}
            )
        )
        return templates, news, False

    @staticmethod
    def _step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
