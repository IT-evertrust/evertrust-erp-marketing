# Importing dependencies
from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
# Importing lead-specific data shapes:
from erp_agents.workflows.reach.lead_satellite.models import (
    LeadSatelliteInput,
    LeadSatelliteOutput
)
from erp_agents.workflows.reach.lead_satellite.prompts import (
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)

class LeadSatelliteWorkflow(Workflow):
    # Name attribute of class:
    name: "reach.lead_satellite"
    
    # Single instance of Llm Client:
    def __init__(self, llm: LlmClient | None = None) -> None:
        self.llm = llm or LlmClient()
        
    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = LeadSatelliteInput.model_validate(job.input)
            
            trace.append(
                AgentTraceStep(
                    name="validate_input",
                    input=job.input,
                    output=workflow_input.model_dump()
                )
            )
            user_prompt = USER_PROMPT_TEMPALTE.format(
                aim_id = workflow_input(aim_id),
                name = workflow_input(name),
                niche = workflow_input(niche),
                region = workflow_input(region),
                segment = workflow_input.segment,
                source = workflow_input.source,
                max_leads = workflow_input.max_leads,
            )
            
            trace.append(
                AgentTraceStep(
                    name="build_prompt",
                    input=workflow_input.model_dump(),
                    output={
                        "system_prompt": SYSTEM_PROMPT,
                        "user_prompt": user_prompt,
                    }
                )
            )
            
            raw_output = self.llm.complete_json(
                system_prompt=SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.2,
            )
            
            trace.append(
                AgentTraceStep(
                    name="llm_compelte_json",
                    input={"model_call": "lead_satellite"},
                    output=raw_output,
                ),
            )
            output = LeadSatelliteOutput.model_validate(raw_output)
            trace.append(
                AgentTraceStep(
                    name="validate_output",
                    input=raw_output,
                    output = output.model_dump()
                ),
            )
            return AgentResult(
                job_id = job.job_id,
                workflow = self.name,
                status="success",
                output=output.model_dump(),
                metrics={
                    "lead_candidates": len(output.lead_candidates),
                    "search_queries": len(output.search_strategy),
                },
                trace=trace,
            )
        except Exception as exc:
            return AgentResult(
                job_id = job.job_id,
                workflow=self.name,
                status="failed",
                errors=[str(exc)],
                trace=trace,
            )