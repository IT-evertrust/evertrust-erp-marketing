from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.nurture.sleeper_grenade.models import (
    CampaignContext,
    ReEngageDraft,
    SleeperAction,
    SleeperGrenadeInput,
    SleeperGrenadeOutput,
    ThreadMessage,
)
from erp_agents.workflows.nurture.sleeper_grenade.prompts import (
    DRAFT_SYSTEM_PROMPT,
    DRAFT_USER_PROMPT_TEMPLATE,
)
from erp_agents.workflows.nurture.sleeper_grenade.tools import (
    decide_action,
    next_snooze_window,
    pick_language,
    ui_bucket_for_action,
)

# Language-aware fallback subjects, used only when the model omits a subject.
_FALLBACK_SUBJECT = {
    "de": "Kurze Rückmeldung von EVERTRUST",
    "en": "A quick follow-up from EVERTRUST",
}


class SleeperGrenadeWorkflow(Workflow):
    """Nurture re-engagement brain (the "Not-Interested Sweep").

    Faithful to the n8n SLEEPER GRENADE (PG) decision + draft logic. In the ERP-driven model the
    agent only ROUTES and DRAFTS; the backend owns selecting snooze-due prospects, the WhatsApp
    approval gate, the Gmail send, suppression/DO_NOT_CONTACT writes, outreach logging, and the
    RE_ENGAGED status update (the n8n side-effect subtrees). Pure JSON in -> AgentResult out.

    Per the agreed brain scope, the agent owns BOTH the action decision
    (RE_ENGAGE / SUPPRESS / SKIP) and the draft. It never calls the LLM for SUPPRESS or SKIP.
    """

    name = "nurture.sleeper_grenade"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self.llm = llm or LlmClient()

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = self.validate_input(job.input)
            trace.append(self.trace_step("validate_input", job.input, workflow_input.model_dump()))

            action, reasoning, confidence = decide_action(
                do_not_contact=workflow_input.do_not_contact,
                status=workflow_input.status,
                email=workflow_input.email,
            )
            trace.append(
                self.trace_step(
                    "decide_action",
                    {"do_not_contact": workflow_input.do_not_contact, "status": workflow_input.status},
                    {"action": action, "reasoning": reasoning, "confidence": confidence},
                )
            )

            # The draft is only produced (and the LLM only called) on the re-engage path.
            draft: ReEngageDraft | None = None
            language = pick_language(
                workflow_input.snooze_reason, self.latest_inbound_body(workflow_input)
            )
            if action == "RE_ENGAGE":
                draft, draft_trace = self.draft_reengage(
                    workflow_input=workflow_input, language=language
                )
                trace.extend(draft_trace)

            output = self.compose_output(
                workflow_input=workflow_input,
                action=action,
                reasoning=reasoning,
                confidence=confidence,
                language=language,
                draft=draft,
            )
            trace.append(self.trace_step("compose_output", None, output.model_dump()))

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics={
                    "action": output.action,
                    "confidence": output.confidence,
                    "language": output.language,
                    "has_draft": output.draft is not None,
                    "followup_count": workflow_input.followup_count,
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

    # ---- steps ----
    def validate_input(self, payload: dict[str, Any]) -> SleeperGrenadeInput:
        return SleeperGrenadeInput.model_validate(payload)

    def draft_reengage(
        self, *, workflow_input: SleeperGrenadeInput, language: str
    ) -> tuple[ReEngageDraft, list[AgentTraceStep]]:
        trace: list[AgentTraceStep] = []
        user_prompt = DRAFT_USER_PROMPT_TEMPLATE.format(
            campaign_context=self.serialize_campaign_context(workflow_input.campaign_context),
            first_name=workflow_input.first_name or "there",
            company_name=workflow_input.company_name or "Unknown",
            status=workflow_input.status or "Not interested (snoozed)",
            snooze_reason=workflow_input.snooze_reason or "Not given",
            thread=self.serialize_previous_thread(workflow_input.previous_thread),
        )
        # Pin the output language deterministically (German for EVERTRUST's base unless the
        # prospect's own prior wording is clearly English) — overrides the model's flaky
        # self-detection, same approach as the Reply Glock draft.
        lang_name = "German" if language == "de" else "English"
        user_prompt += (
            f"\n\nOUTPUT LANGUAGE — STRICT: write the ENTIRE email — subject AND body — "
            f"in {lang_name} only. Do not use any other language."
        )
        trace.append(self.trace_step("draft_prompt", {"system": DRAFT_SYSTEM_PROMPT}, {"user": user_prompt}))

        raw = self.llm.complete_json(
            system_prompt=DRAFT_SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.4
        )
        trace.append(self.trace_step("draft_llm", {"model_call": "draft"}, raw))

        body = (raw.get("body") or "").strip()
        if not body:
            raise ValueError("AI re-engage draft returned an empty body")
        subject = (raw.get("subject") or "").strip() or _FALLBACK_SUBJECT[language]
        return ReEngageDraft(subject=subject, body=body), trace

    def compose_output(
        self,
        *,
        workflow_input: SleeperGrenadeInput,
        action: SleeperAction,
        reasoning: str,
        confidence: float,
        language: str,
        draft: ReEngageDraft | None,
    ) -> SleeperGrenadeOutput:
        return SleeperGrenadeOutput(
            prospect_id=workflow_input.prospect_id,
            email=workflow_input.email,
            first_name=workflow_input.first_name,
            company_name=workflow_input.company_name,
            action=action,
            confidence=confidence,
            reasoning=reasoning,
            language=language,
            draft=draft,
            suppression_reason="do-not-contact" if action == "SUPPRESS" else None,
            # Give the backend a ready window to re-snooze with if the manager declines the send.
            follow_up_date_or_window=next_snooze_window() if action == "RE_ENGAGE" else None,
            ui=ui_bucket_for_action(action),
        )

    # ---- helpers ----
    @staticmethod
    def latest_inbound_body(workflow_input: SleeperGrenadeInput) -> str | None:
        """The prospect's most recent inbound message body, for language detection."""
        for msg in reversed(workflow_input.previous_thread):
            if msg.direction == "inbound" and msg.body:
                return msg.body
        return None

    @staticmethod
    def serialize_campaign_context(ctx: CampaignContext | None) -> str:
        if ctx is None:
            return "No campaign context provided."
        return (
            f"Campaign: {ctx.campaign_name}\n"
            f"Product/Service: {ctx.product_or_service}\n"
            f"Offer: {ctx.offer}\n"
            f"Sender: {ctx.sender_name} ({ctx.sender_company})"
        )

    @staticmethod
    def serialize_previous_thread(thread: list[ThreadMessage]) -> str:
        if not thread:
            return "No earlier messages on record."
        lines = []
        for msg in thread:
            who = msg.from_name or msg.from_email or msg.direction
            lines.append(f"[{msg.direction}] {who}: {msg.body}")
        return "\n".join(lines)

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
