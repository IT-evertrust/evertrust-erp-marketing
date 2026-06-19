import json
from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.engage.reply_glock.models import (
    NormalizedReply,
    ReplyClassification,
    ReplyDraft,
    ReplyGlockInput,
    ReplyGlockOutput
)
from erp_agents.workflows.engage.reply_glock.prompts import (
    CLASSIFY_SYSTEM_PROMPT,
    CLASSIFY_USER_PROMPT_TEMPLATE,
    DRAFT_SYSTEM_PROMPT,
    DRAFT_USER_PROMPT_TEMPLATE
)
from erp_agents.workflows.engage.reply_glock.tools import (
    clean_email_body,
    recommended_action_for_status,
    ui_bucket_for_status,
)

class ReplyGlockWorkflow(Workflow):
    name = "engage.reply_glock"
    # Instantiating 
    def __init__(self, llm: LlmClient | None = None)->None:
        self.llm = llm or LlmClient()
    # Input -> Output
    def run (self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = ReplyGlockInput.model_validate(job.input)
            trace.append(
                AgentTraceStep(
                    name="validate_input",
                    input=job.input,
                    output=workflow_input.model_dump()
                )
            )
            