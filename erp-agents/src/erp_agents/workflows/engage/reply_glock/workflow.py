import json
import re
from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.engage.reply_glock.models import (
    CampaignContext,
    NormalizedReply,
    ReplyClassification,
    ReplyDraft,
    ReplyGlockInput,
    ReplyGlockOutput,
    ThreadMessage,
)
from erp_agents.workflows.engage.reply_glock.prompts import (
    CLASSIFY_SYSTEM_PROMPT,
    CLASSIFY_USER_PROMPT_TEMPLATE,
    DRAFT_SYSTEM_PROMPT,
    DRAFT_USER_PROMPT_TEMPLATE,
)
from erp_agents.workflows.engage.reply_glock.tools import (
    clean_email_body,
    default_snooze_date,
    recommended_action_for_status,
    ui_bucket_for_status,
)

# Deterministic language pick for the draft: German ONLY when the prospect's reply is
# clearly German, otherwise English. The LLM is unreliable at self-detecting language
# (Hermes sometimes drafts German for an English reply), so we decide in code and pin
# it with a hard directive. Bias to English unless there is a strong German signal.
_GERMAN_CHARS = set("äöüßÄÖÜ")
_GERMAN_WORDS = {
    "der", "die", "das", "und", "wir", "sie", "ich", "nicht", "ein", "eine", "ist",
    "danke", "mit", "für", "sind", "haben", "kein", "keine", "gerade", "aktuell",
    "budget", "uns", "unser", "unsere", "vielen", "gruß", "grüße", "hallo", "bitte",
    "derzeit", "momentan", "zurück", "melden", "kontaktieren", "interesse", "leider",
    "jetzt", "nächste", "nächsten", "quartal", "jahr", "wäre", "können", "möchten",
}


def detect_language(text: str) -> str:
    """'de' when the text is clearly German, else 'en' (the default)."""
    t = (text or "").lower()
    if any(c in _GERMAN_CHARS for c in t):
        return "de"
    words = re.findall(r"[a-zäöüß]+", t)
    hits = sum(1 for w in words if w in _GERMAN_WORDS)
    return "de" if hits >= 2 else "en"


# Maps each status to the draft's purpose when the LLM omits/garbles it.
_DEFAULT_PURPOSE: dict[str, str] = {
    "INTERESTED": "MOVE_TO_MEETING",
    "UNSURE": "ANSWER_QUESTION",
    "UNINTERESTED": "CLOSE_POLITELY",
    "TEMPORARY": "SCHEDULE_FUTURE_FOLLOW_UP",
}


class ReplyGlockWorkflow(Workflow):
    """Engage reply classifier + response drafter.

    Faithful to the n8n REPLY GLOCK (PG) classification + draft brain. In the ERP-driven model
    the agent only classifies and drafts; the backend owns sending, booking, graduation, and
    persistence (the n8n side-effect subtrees). Pure JSON in -> structured AgentResult out.
    """

    name = "engage.reply_glock"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self.llm = llm or LlmClient()

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = self.validate_input(job.input)
            trace.append(self.trace_step("validate_input", job.input, workflow_input.model_dump()))

            normalized = self.normalize_reply(workflow_input)
            trace.append(
                self.trace_step("normalize_reply", {"body": workflow_input.body}, normalized.model_dump())
            )

            classification, classify_trace = self.classify_reply(
                workflow_input=workflow_input, normalized=normalized
            )
            trace.extend(classify_trace)

            draft, draft_trace = self.draft_reply(
                workflow_input=workflow_input, normalized=normalized, classification=classification
            )
            trace.extend(draft_trace)

            output = self.compose_output(
                workflow_input=workflow_input,
                normalized=normalized,
                classification=classification,
                draft=draft,
            )
            trace.append(self.trace_step("compose_output", None, output.model_dump()))

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics={
                    "status": output.status,
                    "confidence": output.confidence,
                    "recommended_action": output.recommended_action,
                    "thread_messages": len(workflow_input.previous_thread),
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
    def validate_input(self, payload: dict[str, Any]) -> ReplyGlockInput:
        return ReplyGlockInput.model_validate(payload)

    def normalize_reply(self, workflow_input: ReplyGlockInput) -> NormalizedReply:
        clean_body, flags = clean_email_body(workflow_input.body)
        return NormalizedReply(
            clean_body=clean_body,
            detected_language=None,
            removed_quoted_text=flags["removed_quoted_text"],
            removed_signature=flags["removed_signature"],
        )

    def classify_reply(
        self, *, workflow_input: ReplyGlockInput, normalized: NormalizedReply
    ) -> tuple[ReplyClassification, list[AgentTraceStep]]:
        trace: list[AgentTraceStep] = []
        user_prompt = CLASSIFY_USER_PROMPT_TEMPLATE.format(
            campaign_context=self.serialize_campaign_context(workflow_input.campaign_context),
            thread=self.serialize_previous_thread(workflow_input.previous_thread),
            sender_name=workflow_input.sender_name or "Unknown",
            company=workflow_input.company or "Unknown",
            subject=workflow_input.subject,
            clean_body=normalized.clean_body,
        )
        trace.append(self.trace_step("classify_prompt", {"system": CLASSIFY_SYSTEM_PROMPT}, {"user": user_prompt}))

        raw = self.llm.complete_json(
            system_prompt=CLASSIFY_SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.1
        )
        trace.append(self.trace_step("classify_llm", {"model_call": "classify"}, raw))

        classification = ReplyClassification.model_validate(raw)
        return classification, trace

    def draft_reply(
        self,
        *,
        workflow_input: ReplyGlockInput,
        normalized: NormalizedReply,
        classification: ReplyClassification,
    ) -> tuple[ReplyDraft, list[AgentTraceStep]]:
        trace: list[AgentTraceStep] = []
        user_prompt = DRAFT_USER_PROMPT_TEMPLATE.format(
            campaign_context=self.serialize_campaign_context(workflow_input.campaign_context),
            status=classification.status,
            reasoning=classification.reasoning,
            signals=json.dumps(classification.extracted_signals.model_dump()),
            sender_name=workflow_input.sender_name or "Unknown",
            company=workflow_input.company or "Unknown",
            subject=workflow_input.subject,
            clean_body=normalized.clean_body,
        )
        # Pin the output language deterministically (German iff the prospect's reply is
        # clearly German, else English) — overrides the model's flaky self-detection.
        lang = detect_language(normalized.clean_body)
        lang_name = "German" if lang == "de" else "English"
        user_prompt += (
            f"\n\nOUTPUT LANGUAGE — STRICT: the prospect wrote in {lang_name}. "
            f"Write the ENTIRE reply — subject AND body — in {lang_name} only. "
            f"Do not use any other language."
        )
        trace.append(self.trace_step("draft_prompt", {"system": DRAFT_SYSTEM_PROMPT}, {"user": user_prompt}))

        raw = self.llm.complete_json(
            system_prompt=DRAFT_SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.3
        )
        trace.append(self.trace_step("draft_llm", {"model_call": "draft"}, raw))

        raw.setdefault("purpose", _DEFAULT_PURPOSE[classification.status])
        if not raw.get("subject"):
            raw["subject"] = f"Re: {workflow_input.subject}"
        draft = ReplyDraft.model_validate(raw)
        return draft, trace

    def compose_output(
        self,
        *,
        workflow_input: ReplyGlockInput,
        normalized: NormalizedReply,
        classification: ReplyClassification,
        draft: ReplyDraft,
    ) -> ReplyGlockOutput:
        signals = classification.extracted_signals
        follow_up_needed = classification.status in ("TEMPORARY", "UNSURE")
        # For TEMPORARY, fall back to the +60d snooze window when the lead gave no explicit date.
        follow_up_window = signals.follow_up_date_or_window
        if classification.status == "TEMPORARY" and not follow_up_window:
            follow_up_window = default_snooze_date()

        return ReplyGlockOutput(
            reply_id=workflow_input.reply_id,
            campaign_id=workflow_input.campaign_id,
            lead_id=workflow_input.lead_id,
            status=classification.status,
            confidence=classification.confidence,
            reasoning=classification.reasoning,
            sender_name=workflow_input.sender_name,
            sender_email=workflow_input.sender_email,
            company=workflow_input.company,
            original_subject=workflow_input.subject,
            clean_body=normalized.clean_body,
            extracted_signals=signals,
            recommended_action=recommended_action_for_status(classification.status),
            draft=draft,
            follow_up_needed=follow_up_needed,
            follow_up_date_or_window=follow_up_window,
            ui=ui_bucket_for_status(classification.status),
        )

    # ---- helpers ----
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
            return "No previous messages."
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
