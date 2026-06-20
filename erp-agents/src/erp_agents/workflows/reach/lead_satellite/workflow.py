"""Lead Satellite workflow — finds prospect leads for a campaign.

Flow: validate config -> plan search queries -> generate leads (LLM or offline) ->
dedup -> compose. Any LLM error falls back to the deterministic offline generator,
so a campaign always gets leads it can store and display.
"""

from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.reach.lead_satellite.models import (
    LeadCandidate,
    LeadSatelliteInput,
    LeadSatelliteOutput,
)
from erp_agents.workflows.reach.lead_satellite.prompts import (
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from erp_agents.workflows.reach.lead_satellite.tools import (
    dedup_leads,
    offline_leads,
    plan_search_queries,
)


class LeadSatelliteWorkflow(Workflow):
    name = "reach.lead_satellite"

    def __init__(self, llm: LlmClient | None = None) -> None:
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
            data = LeadSatelliteInput.model_validate(job.input)
            trace.append(self._step("validate_input", job.input, data.model_dump()))

            queries = plan_search_queries(data)
            trace.append(self._step("plan_search", None, {"queries": queries}))

            leads, used_llm = self._find_leads(data, queries, trace, notes)
            leads = dedup_leads(leads)[: data.max_leads]
            trace.append(self._step("dedup", None, {"count": len(leads)}))

            output = LeadSatelliteOutput(
                campaign_id=data.campaign_id,
                search_strategy=queries,
                leads=leads,
                generated_by="llm" if used_llm else "offline",
                notes=notes,
            )
            trace.append(self._step("compose_output", None, output.model_dump()))

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics={
                    "leads_found": len(leads),
                    "queries": len(queries),
                    "generated_by": output.generated_by,
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

    def _find_leads(
        self,
        data: LeadSatelliteInput,
        queries: list[str],
        trace: list[AgentTraceStep],
        notes: list[str],
    ) -> tuple[list[LeadCandidate], bool]:
        if self.llm is not None:
            user = USER_PROMPT_TEMPLATE.format(
                name=data.name or "(unnamed campaign)",
                niche=data.niche,
                region=data.region,
                country=data.country,
                segment=data.segment or "(none)",
                source=data.source or "(any)",
                max_leads=data.max_leads,
            )
            try:
                raw = self.llm.complete_json(
                    system_prompt=SYSTEM_PROMPT, user_prompt=user, temperature=0.3
                )
                candidates = [
                    LeadCandidate.model_validate(item)
                    for item in (raw.get("leads") or [])
                ]
                if candidates:
                    trace.append(self._step("find_leads_llm", {"call": "leads"}, raw))
                    return candidates, True
                notes.append("LLM returned no leads; using offline generator.")
            except Exception as exc:
                notes.append(f"lead search fell back to offline: {exc}")
        leads = offline_leads(data)
        trace.append(self._step("find_leads_offline", None, {"count": len(leads)}))
        return leads, False

    @staticmethod
    def _step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
