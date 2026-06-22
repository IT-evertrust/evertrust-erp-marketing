from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.engage.rag_agent.models import RagAgentInput, RagAgentOutput
from erp_agents.workflows.engage.rag_agent.prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from erp_agents.workflows.engage.rag_agent.tools import format_thread, normalize_draft


class RagAgentWorkflow(Workflow):
    """Engage RAG drafter for UNSURE replies.

    Faithful to the n8n RAG AGENT (PG): grounds ONLY on the email thread (no Drive/KB/Qdrant),
    drafts a confident "Hanna" reply, and emits the 7-field analysis for human review in the
    ERP queue. The n8n version ran gpt-4o; per the local-Hermes mandate this uses the gateway
    model (settings.llm_model, default 'hermes'). The backend owns persistence + notifications.
    """

    name = "engage.rag_agent"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self.llm = llm or LlmClient()

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = self.validate_input(job.input)
            trace.append(self.trace_step("validate_input", job.input, workflow_input.model_dump()))

            thread_text = format_thread(workflow_input.thread, workflow_input.lead_email)
            trace.append(
                self.trace_step(
                    "format_thread",
                    {"messages": len(workflow_input.thread)},
                    {"thread_text": thread_text},
                )
            )

            user_prompt = USER_PROMPT_TEMPLATE.format(
                company=workflow_input.company or "Unknown",
                country=workflow_input.country or "Unknown",
                lead_email=workflow_input.lead_email or "Unknown",
                thread=thread_text,
            )
            trace.append(self.trace_step("build_prompt", {"system": SYSTEM_PROMPT}, {"user": user_prompt}))

            raw = self.llm.complete_json(
                system_prompt=SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.2
            )
            trace.append(self.trace_step("draft_llm", {"model_call": "rag_draft"}, raw))

            raw = normalize_draft(raw, validate_area=True)
            output = RagAgentOutput.model_validate(raw)
            trace.append(self.trace_step("validate_output", raw, output.model_dump(by_alias=True)))

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(by_alias=True),
                metrics={
                    "prospect_id": workflow_input.prospect_id,
                    "unsure_area": output.unsure_area,
                    "draft_chars": len(output.draft_reply),
                    "citations": len(output.citations),
                    "thread_messages": len(workflow_input.thread),
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

    def validate_input(self, payload: dict[str, Any]) -> RagAgentInput:
        return RagAgentInput.model_validate(payload)

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
