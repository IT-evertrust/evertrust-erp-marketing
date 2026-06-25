from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.engage.refine_training.models import (
    RefineTrainingInput,
    RefineTrainingOutput,
)
from erp_agents.workflows.engage.refine_training.prompts import (
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)


def _clean_rule(text: str) -> str:
    """Collapse to a single tidy line: drop code fences, leading bullets/quotes, and
    any extra lines the small model may emit."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # strip a fenced block if the model wrapped the answer
        inner = cleaned.strip("`")
        cleaned = inner.split("\n", 1)[-1] if "\n" in inner else inner
    # take the first non-empty line
    for line in cleaned.splitlines():
        line = line.strip()
        if line:
            cleaned = line
            break
    # strip a leading list marker and wrapping quotes
    cleaned = cleaned.lstrip("-*•0123456789. ").strip()
    if len(cleaned) >= 2 and cleaned[0] in "\"'" and cleaned[-1] == cleaned[0]:
        cleaned = cleaned[1:-1].strip()
    return cleaned


class RefineTrainingWorkflow(Workflow):
    """Rephrase a raw operator coaching note into ONE clean persona rule.

    Backs the Engage "Train · Feedback" box: whatever the operator types is sent here,
    the model turns it into a single declarative instruction, and the backend appends
    that to the selected persona's system prompt.
    """

    name = "engage.refine_training"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self.llm = llm or LlmClient()

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = self.validate_input(job.input)
            trace.append(
                self.trace_step("validate_input", job.input, workflow_input.model_dump())
            )

            user_prompt = USER_PROMPT_TEMPLATE.format(
                persona_name=workflow_input.persona_name or "the default voice",
                campaign_context=workflow_input.campaign_context or "(none)",
                note=workflow_input.note,
            )
            trace.append(
                self.trace_step("build_prompt", {"system": SYSTEM_PROMPT}, {"user": user_prompt})
            )

            raw = self.llm.complete_text(
                system_prompt=SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.2
            )
            rule = _clean_rule(raw)
            # Never return empty — fall back to the original note so the backend always
            # has something to persist.
            if not rule:
                rule = workflow_input.note.strip()
            trace.append(self.trace_step("rephrase_llm", {"raw": raw}, {"rule": rule}))

            output = RefineTrainingOutput(rule=rule)
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics={"in_chars": len(workflow_input.note), "out_chars": len(rule)},
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

    def validate_input(self, payload: dict[str, Any]) -> RefineTrainingInput:
        return RefineTrainingInput.model_validate(payload)

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
